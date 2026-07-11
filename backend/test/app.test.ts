import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('createApp（ライセンス専用バックエンド）', () => {
  it('GET /health は 200 と { ok: true } を返す（引継書§7③の最小応答）', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('未定義ルートは 404（公的API・usage系ルートを持たない＝引継書§2）', async () => {
    const app = createApp();
    for (const path of ['/resolve', '/enrich', '/invoice', '/usage']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
    }
  });

  it('Stripe/署名鍵 未設定時、/license/verify は 503 で明示する（無言で失敗しない）', async () => {
    const app = createApp();
    const res = await app.request('/license/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'x' }),
    });
    expect(res.status).toBe(503);
  });
});
