# quote-invoice-maker — 見積書・請求書メーカー for Google Sheets

フリーランス・零細事業者向けの Google Sheets 用エディタアドオン。
見積書→請求書のワンクリック変換、源泉所得税・消費税（適格請求書対応）の自動計算、
電帳法の実務に沿ったファイル名でのPDF出力・Drive自動保存を一気通貫で提供する。

- 要件の正: `docs/requirements.md`（v1.0）／実装引継: `docs/handover.md`／掲載文言の正: `docs/marketing.md`
- 判断ログ: `docs/decisions.md`（1行/件）
- **絶対制約**: CR-1〜5（`docs/handover.md §13` の Do/Don't）。OAuthスコープは4点固定・
  インボイス登録番号の照会/検証コード禁止・シークレットをリポジトリに置かない。

## 構成（pnpm workspace）

| パス | 内容 |
|---|---|
| `apps-script/` | GASアドオン本体（TypeScript→esbuild→単一 `dist/Code.js`。clasp rootDir=dist） |
| `backend/` | ライセンス専用バックエンド（Hono+TS・Cloud Run・ステートレス。柱3 `b516718` から移植） |
| `web/` | LP・privacy・terms・特商法・thanks・license-recover（GitHub Pages 公開） |
| `scripts/check-oauth-scopes.mjs` | CR-3 スコープ差分チェック（CIでビルド前後2回） |
| `docs/setup/` | 人間タスクの手順書（clasp・gcp-oauth・domain-pages・spike-v1-v2） |

## 開発

```bash
pnpm install
pnpm typecheck && pnpm test   # 着手前に緑を確認（golden は自動上書き禁止）
pnpm build                    # apps-script: esbuild / backend: tsc
node scripts/check-oauth-scopes.mjs
```

- GASの実機セットアップ: `docs/setup/clasp.md`
- V-1/V-2スパイク（PDF export / Drive保存の実機検証）: `docs/setup/spike-v1-v2.md`
- backend のローカル起動・デプロイ・鍵導出: `backend/README.md`

## 運用・保守

- **税制の年次点検（N-7）**: 以下を**年1回**（毎年1月・税制改正の施行前後）点検し、加えて
  大きな税制改正の報道があった時点でも都度確認する。差分があれば要件書§6を改訂してから実装に反映する。
  - 消費税率（10%／軽減8%）と適格請求書の端数処理ルール（税率ごとに1回・消令70の10）
  - 源泉所得税率（10.21%／100万円超部分20.42%・復興特別所得税を含む）と1円未満切捨ての取扱い
  - 適格請求書の記載事項6項目（要件書§6-3）・区分記載請求書の記載事項（§6-4）
  - 国税庁 電子帳簿保存法一問一答【電子取引関係】の改訂（ファイル名例示・検索要件の緩和条件）
- **公開後の監視（要件書§10）**: 公開後は毎日1回×7日間の動作確認→以後は**週次監視**へ移行
  （サイドバー起動・PDF出力・`/health`・Cloud Run 5xxアラートの確認）。
- **問い合わせ対応**: 一次返信 **48時間SLA**（要件書§10）。FAQ・サイドバー内ヘルプで問い合わせを前倒しで削減する（N-5）。
- 保守枠は事業全体の週1時間・本プロダクト単体は月2時間以内目標（N-5）。

## テスト

- `apps-script/test/calc.test.ts` — golden G-1〜G-11（要件書§6-6。**fixture の自動上書き禁止**）
- `apps-script/test/cr-compliance.test.ts` — CR-1走査（照会コード不存在）・価格/無料枠定数の docs 一致
- `apps-script/test/scopes.test.ts` ＋ CI — CR-3 スコープ4点固定
- `backend/test/` — ライセンス発行/検証・ルート・webhook（柱3テストを移植）
