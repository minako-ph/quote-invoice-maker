import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerLicenseRoutes } from '../src/routes/license.js';
import { registerStripeWebhookRoute } from '../src/routes/stripeWebhook.js';
import type { IssueOutcome, LicenseVerification } from '../src/services/license.js';
import type { WebhookEvent } from '../src/services/stripeGateway.js';

/**
 * /license/* ・/stripe/webhook のルートテスト（柱3から移植。引継書§7）。
 * 実 Stripe・実署名検証は使わず、依存を注入したフェイクで挙動を固定する。
 */

async function post(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /license/claim', () => {
  function makeApp(claimFromSession: (sessionId: string) => Promise<IssueOutcome>) {
    const app = new Hono();
    registerLicenseRoutes(app, {
      claimFromSession,
      recoverByEmail: () => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }),
      verify: () => Promise.resolve<LicenseVerification>({ valid: false }),
    });
    return app;
  }

  it('正常: licenseKey を返す', async () => {
    const app = makeApp(() => Promise.resolve<IssueOutcome>({ ok: true, licenseKey: 'KEY123' }));
    const res = await post(app, '/license/claim', { sessionId: 'sess_1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licenseKey: 'KEY123' });
  });

  it('未払いは 402', async () => {
    const app = makeApp(() => Promise.resolve<IssueOutcome>({ ok: false, reason: 'unpaid' }));
    const res = await post(app, '/license/claim', { sessionId: 'sess_1' });
    expect(res.status).toBe(402);
  });

  it('見つからない Session は 404', async () => {
    const app = makeApp(() => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }));
    const res = await post(app, '/license/claim', { sessionId: 'nope' });
    expect(res.status).toBe(404);
  });

  it('sessionId 欠落は 400', async () => {
    const app = makeApp(() => Promise.resolve<IssueOutcome>({ ok: true, licenseKey: 'x' }));
    const res = await post(app, '/license/claim', {});
    expect(res.status).toBe(400);
  });

  it('上流エラー（throw）は 503', async () => {
    const app = makeApp(() => Promise.reject(new Error('stripe down')));
    const res = await post(app, '/license/claim', { sessionId: 'sess_1' });
    expect(res.status).toBe(503);
  });
});

describe('POST /license/recover（クールダウン）', () => {
  function makeApp(opts: {
    recoverByEmail?: (email: string) => Promise<IssueOutcome>;
    now?: () => number;
    cooldownMs?: number;
  }) {
    const app = new Hono();
    registerLicenseRoutes(app, {
      claimFromSession: () => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }),
      recoverByEmail:
        opts.recoverByEmail ?? (() => Promise.resolve<IssueOutcome>({ ok: true, licenseKey: 'RKEY' })),
      verify: () => Promise.resolve<LicenseVerification>({ valid: false }),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.cooldownMs !== undefined ? { recoverCooldownMs: opts.cooldownMs } : {}),
    });
    return app;
  }

  const IP = { 'x-forwarded-for': '203.0.113.10' };

  it('有効購読ありは licenseKey を返す', async () => {
    const app = makeApp({});
    const res = await post(app, '/license/recover', { email: 'ok@example.com' }, IP);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licenseKey: 'RKEY' });
  });

  it('該当なしは 404（一律文言）', async () => {
    const app = makeApp({ recoverByEmail: () => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }) });
    const res = await post(app, '/license/recover', { email: 'x@example.com' }, IP);
    expect(res.status).toBe(404);
  });

  it('email 欠落は 400', async () => {
    const app = makeApp({});
    const res = await post(app, '/license/recover', {}, IP);
    expect(res.status).toBe(400);
  });

  it('同一IPの60秒以内の連投は 429', async () => {
    let clock = 1_000_000;
    const app = makeApp({ now: () => clock, cooldownMs: 60_000 });

    const first = await post(app, '/license/recover', { email: 'a@example.com' }, IP);
    expect(first.status).toBe(200);

    // 30秒後（クールダウン内）は 429
    clock += 30_000;
    const second = await post(app, '/license/recover', { email: 'b@example.com' }, IP);
    expect(second.status).toBe(429);

    // 61秒経過後は再度許可
    clock += 31_000;
    const third = await post(app, '/license/recover', { email: 'c@example.com' }, IP);
    expect(third.status).toBe(200);
  });

  it('別IPはクールダウンを共有しない', async () => {
    const clock = 1_000_000;
    const app = makeApp({ now: () => clock, cooldownMs: 60_000 });
    const a = await post(app, '/license/recover', { email: 'a@example.com' }, { 'x-forwarded-for': '198.51.100.1' });
    const b = await post(app, '/license/recover', { email: 'a@example.com' }, { 'x-forwarded-for': '198.51.100.2' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('レート制限は処理前に判定し recoverByEmail を呼ばない（email 総当たり抑止）', async () => {
    let clock = 1_000_000;
    const recover = vi.fn(() => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }));
    const app = makeApp({ now: () => clock, cooldownMs: 60_000, recoverByEmail: recover });

    await post(app, '/license/recover', { email: 'a@example.com' }, IP);
    clock += 1000;
    await post(app, '/license/recover', { email: 'b@example.com' }, IP); // 429（呼ばれない）
    expect(recover).toHaveBeenCalledTimes(1);
  });
});

describe('POST /license/verify', () => {
  function makeApp(verify: (key: string) => Promise<LicenseVerification>) {
    const app = new Hono();
    registerLicenseRoutes(app, {
      claimFromSession: () => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }),
      recoverByEmail: () => Promise.resolve<IssueOutcome>({ ok: false, reason: 'not_found' }),
      verify,
    });
    return app;
  }

  it('valid な結果をそのまま返す', async () => {
    const app = makeApp(() => Promise.resolve<LicenseVerification>({ valid: true, plan: 'pro', periodEnd: 123 }));
    const res = await post(app, '/license/verify', { licenseKey: 'KEY' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true, plan: 'pro', periodEnd: 123 });
  });

  it('invalid は { valid: false }', async () => {
    const app = makeApp(() => Promise.resolve<LicenseVerification>({ valid: false }));
    const res = await post(app, '/license/verify', { licenseKey: 'KEY' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it('licenseKey 欠落は 400', async () => {
    const app = makeApp(() => Promise.resolve<LicenseVerification>({ valid: false }));
    const res = await post(app, '/license/verify', {});
    expect(res.status).toBe(400);
  });

  it('上流エラーは 503', async () => {
    const app = makeApp(() => Promise.reject(new Error('stripe down')));
    const res = await post(app, '/license/verify', { licenseKey: 'KEY' });
    expect(res.status).toBe(503);
  });
});

describe('POST /stripe/webhook（署名検証）', () => {
  function makeApp(opts: {
    webhookSecret?: string;
    constructEvent?: (rawBody: string, signature: string, secret: string) => WebhookEvent;
  }) {
    const app = new Hono();
    registerStripeWebhookRoute(app, {
      webhookSecret: opts.webhookSecret ?? 'whsec_test',
      constructEvent:
        opts.constructEvent ??
        (() => {
          throw new Error('signature invalid');
        }),
    });
    return app;
  }

  it('署名不正は 400', async () => {
    const app = makeApp({
      constructEvent: () => {
        throw new Error('signature invalid');
      },
    });
    const res = await post(app, '/stripe/webhook', { any: 'payload' }, { 'stripe-signature': 't=1,v1=bad' });
    expect(res.status).toBe(400);
  });

  it('署名ヘッダ欠落は 400', async () => {
    const app = makeApp({ constructEvent: () => ({ type: 'checkout.session.completed' }) });
    const res = await post(app, '/stripe/webhook', { any: 'payload' });
    expect(res.status).toBe(400);
  });

  it('checkout.session.completed は 200・handled=true（保存なし）', async () => {
    const app = makeApp({ constructEvent: () => ({ type: 'checkout.session.completed' }) });
    const res = await post(app, '/stripe/webhook', { any: 'payload' }, { 'stripe-signature': 't=1,v1=ok' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: true });
  });

  it('他イベントは 200・handled=false で無視', async () => {
    const app = makeApp({ constructEvent: () => ({ type: 'invoice.paid' }) });
    const res = await post(app, '/stripe/webhook', { any: 'payload' }, { 'stripe-signature': 't=1,v1=ok' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: false });
  });

  it('secret 未設定は 503', async () => {
    const app = makeApp({ webhookSecret: '', constructEvent: () => ({ type: 'checkout.session.completed' }) });
    const res = await post(app, '/stripe/webhook', { any: 'payload' }, { 'stripe-signature': 't=1,v1=ok' });
    expect(res.status).toBe(503);
  });
});

describe('CORS（F-1: claim/recover のみ・thanks/license-recover のブラウザfetch用）', () => {
  // 実配線（routes/index.ts）を検証するため createApp を使う。
  // Stripe未設定でも cors の use 登録は分岐より前のため効くこと（503にもACAOが付く）を確認する。

  it('OPTIONS /license/claim はプリフライト成功（204＋Access-Control-Allow-Origin）', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await app.request('/license/claim', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.github.io',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('OPTIONS /license/recover もプリフライト成功', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await app.request('/license/recover', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.github.io',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /license/claim の応答に Access-Control-Allow-Origin が付く（未設定時503でも）', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await post(app, '/license/claim', { sessionId: 'sess_1' }, { origin: 'https://example.github.io' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('POST /license/verify には CORS ヘッダを付けない（GASサーバ間通信のみ）', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await post(app, '/license/verify', { licenseKey: 'x' }, { origin: 'https://example.github.io' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
