/**
 * 環境変数の読み取りと型付け（引継書§7・§9）。
 *
 * 本バックエンドは**ライセンス専用（ステートレス・Firestore不使用）**のため、
 * 環境変数は STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / LICENSE_SIGNING_KEY / PORT のみ。
 *
 * 絶対規則: 環境変数の**値**をログ・エラーメッセージに含めない（CR-5）。
 * バリデーションエラーは変数名のみを示し、値は出力しない。
 */

export interface Config {
  /** Stripe シークレットキー（FR-10）。 */
  readonly stripeSecretKey: string;
  /** Stripe Webhook 署名シークレット。 */
  readonly stripeWebhookSecret: string;
  /** ライセンスキー署名鍵（Ed25519 PKCS8 PEM。柱3とは別の新規ペア＝引継書§9）。 */
  readonly licenseSigningKey: string;
  /** listen ポート。既定 8080（Cloud Run が注入）。 */
  readonly port: number;
}

/**
 * 文字列環境変数を取り出す。未設定・空文字は既定値。
 * 値そのものは返すが、ここでログしない（呼び出し側もログ禁止）。
 */
function readString(raw: string | undefined, fallback: string): string {
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

/**
 * 正の数値環境変数を取り出す。不正値は変数名のみを示して throw（値は出力しない）。
 * @param name 変数名（エラーメッセージ用。値は含めない）
 */
function readPositiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // 値は含めない（CR-5）。
    throw new Error(`Invalid value for ${name}: expected a positive number`);
  }
  return parsed;
}

/**
 * 環境変数から Config を構築する。テスト容易性のため env を注入可能にする。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    stripeSecretKey: readString(env.STRIPE_SECRET_KEY, ''),
    stripeWebhookSecret: readString(env.STRIPE_WEBHOOK_SECRET, ''),
    licenseSigningKey: readString(env.LICENSE_SIGNING_KEY, ''),
    port: readPositiveNumber('PORT', env.PORT, 8080),
  };
}
