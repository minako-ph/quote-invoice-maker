# backend — ライセンス専用バックエンド（Cloud Run）

quote-invoice-maker のライセンス発行・検証・Stripe webhook 受信のみを担う、
**ステートレス**な Hono + TypeScript サーバ（柱3 company-list-cleaner `b516718` からのコピー移植。引継書§7）。

- 何も永続化しない（Firestore・DBなし）。ライセンスキーは Ed25519(EdDSA) 署名の JWT で、
  検証は「署名 ＋ Stripe 購読照会」で成立する。
- ルート: `POST /license/claim` / `POST /license/recover` / `POST /license/verify` /
  `POST /stripe/webhook` / `GET /health`。
- **柱3とは別の署名鍵ペア・別の iss/aud**（`quote-invoice-maker` / `quote-invoice-maker-license`）で
  発行し、製品間でキーを相互流用できないようにする（引継書§2）。

## ローカル開発

```bash
cp backend/.env.example backend/.env   # 値を埋める（.env は gitignore 済み）
pnpm --filter backend dev              # --env-file=.env で起動
pnpm --filter backend test
```

## ビルドとスモーク（デプロイ前必須）

柱3で「dist起動不可（ERR_UNKNOWN_FILE_EXTENSION）」の既知事故があるため、
デプロイ前に必ずローカルで dist 起動スモークを実施し、結果を docs/decisions.md に記録する（引継書§7）。

```bash
pnpm --filter backend build
node --env-file=backend/.env backend/dist/index.js
# 別ターミナルで
curl -s localhost:8080/health   # => {"ok":true}
```

## Ed25519 鍵ペアの導出（LICENSE_SIGNING_KEY）

**柱3とは別の新規ペア**を必ず生成する（引継書§2・§9）。鍵ファイルはリポジトリに置かない
（`*.pem` は gitignore 済み。生成後は安全な場所に保管し、Secret Manager へ投入する）。

```bash
# 秘密鍵（PKCS8 PEM）— これを LICENSE_SIGNING_KEY に設定する
openssl genpkey -algorithm ed25519 -out license-signing-key.pem
cat license-signing-key.pem

# 公開鍵（参考。本製品のGAS側は /license/verify 委譲のため公開鍵を配布しない）
openssl pkey -in license-signing-key.pem -pubout
```

環境変数に入れる際は PEM の改行を保ったまま設定する（Cloud Run の Secret Manager 参照なら
ファイル内容をそのまま登録すればよい）。

## Stripe Dashboard 設定（人間タスク）

1. **Product/Price**: 既存の Stripe アカウントに新 Product「見積書・請求書メーカー Pro」を作成し、
   月額 **¥1,480（税込単価として設定）** の recurring Price を作る。
   特商法表記・Marketplaceリスティングと**同一文言**にする（三者不一致は審査差し戻しの典型。引継書§8）。
2. **Payment Link / Checkout**: 成功URLは
   `https://pelmoalabs.com/quote-invoice-maker/thanks.html?session_id={CHECKOUT_SESSION_ID}`
   （サブディレクトリ方式＝docs/setup/domain-pages.md）。
3. **カスタマーポータル**: 解約導線として有効化（解約後も当該課金期間の満了までProを利用できる設定と
   特商法表記を一致させる）。
4. **Webhook**: エンドポイント `https://<Cloud Run URL>/stripe/webhook`、イベントは
   `checkout.session.completed` のみ。署名シークレットを `STRIPE_WEBHOOK_SECRET` へ。
5. シークレットキー（`sk_...`）を `STRIPE_SECRET_KEY` へ（テストモードで課金E2Eを先に通す）。

## Cloud Run デプロイ（人間タスク。引継書§7）

```bash
# ビルドは workspace ルートをコンテキストにする
docker build -f backend/Dockerfile -t quote-invoice-maker-backend .

# region=asia-northeast1 / max-instances=1（コスト上限ガード）/ min-instances=0
gcloud run deploy quote-invoice-maker-backend \
  --image <pushed-image> \
  --region asia-northeast1 \
  --max-instances 1 --min-instances 0 \
  --set-secrets STRIPE_SECRET_KEY=...,STRIPE_WEBHOOK_SECRET=...,LICENSE_SIGNING_KEY=...
```

デプロイ後:
- GAS の Script Properties `BACKEND_URL` に Cloud Run URL を設定し、
  `apps-script/appsscript.json` の `urlFetchWhitelist` にも同URLを追記する（公開アドオンで強制されるため）。
- web/thanks.html・web/license-recover.html の `BACKEND_URL` プレースホルダを差し替える。
- 監視: GCP コンソールで Cloud Run の 5xx アラートを設定（N-4。`/health` を対象に死活監視）。
