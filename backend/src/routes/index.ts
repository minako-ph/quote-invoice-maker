import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig } from '../config.js';
import { registerLicenseRoutes } from './license.js';
import { registerStripeWebhookRoute } from './stripeWebhook.js';
import { createLicenseService, type LicenseService } from '../services/license.js';
import { createStripeGateway, type StripeGateway } from '../services/stripeGateway.js';

/**
 * ルート登録の集約点（ライセンス専用バックエンド。引継書§3・§7）。
 *
 * `/license/claim` `/license/recover` `/license/verify`・`/stripe/webhook`・`/health` のみを持つ。
 * 公的API・Firestore・quota・監視トラッカーは**持たない**（引継書§2: バックエンドは
 * ライセンス専用に縮小。N-3「無料利用ではシート外へのデータ送信ゼロ」の成立要件）。
 */
export function registerRoutes(app: Hono): void {
  const config = loadConfig();

  // /health は最小応答（引継書§7③）。Cloud Run の5xxアラート・死活監視用。
  app.get('/health', (c) => c.json({ ok: true }));

  // F-1: thanks.html / license-recover.html は GitHub Pages（別オリジン）からブラウザ fetch する
  // ため、claim / recover の2ルートのみ CORS を許可する（origin '*'・credentials なし。
  // 認可の実体は sessionId／email＋IPクールダウンであり、CORS は境界ではない）。
  // /license/verify は GAS サーバ間通信・/stripe/webhook は Stripe サーバからのため付けない。
  // 未設定時503の early return 側にも効くよう、分岐より前に登録する。
  app.use('/license/claim', cors());
  app.use('/license/recover', cors());

  // ライセンス（FR-10）。Stripe/署名鍵が未設定なら license サービスは生成しない
  // （ルートは配線しつつ 503 で明示する＝無言で失敗しない）。
  const configured = config.stripeSecretKey !== '' && config.licenseSigningKey !== '';
  const gateway: StripeGateway | undefined = configured
    ? createStripeGateway(config.stripeSecretKey)
    : undefined;
  const license: LicenseService | undefined =
    gateway !== undefined
      ? createLicenseService({ signingKeyPem: config.licenseSigningKey, gateway })
      : undefined;

  if (license === undefined || gateway === undefined) {
    const unavailable = { error: 'not_configured', message: 'ライセンス機能は現在利用できません' };
    for (const path of ['/license/claim', '/license/recover', '/license/verify']) {
      app.post(path, (c) => c.json(unavailable, 503));
    }
    app.post('/stripe/webhook', (c) => c.json(unavailable, 503));
    return;
  }

  registerLicenseRoutes(app, {
    claimFromSession: (sessionId) => license.claimFromSession(sessionId),
    recoverByEmail: (email) => license.recoverByEmail(email),
    verify: (licenseKey) => license.verifyLicenseKey(licenseKey),
  });

  registerStripeWebhookRoute(app, {
    webhookSecret: config.stripeWebhookSecret,
    constructEvent: (rawBody, signature, secret) =>
      gateway.constructWebhookEvent(rawBody, signature, secret),
  });
}
