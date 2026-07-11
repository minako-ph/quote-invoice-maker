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

## テスト

- `apps-script/test/calc.test.ts` — golden G-1〜G-11（要件書§6-6。**fixture の自動上書き禁止**）
- `apps-script/test/cr-compliance.test.ts` — CR-1走査（照会コード不存在）・価格/無料枠定数の docs 一致
- `apps-script/test/scopes.test.ts` ＋ CI — CR-3 スコープ4点固定
- `backend/test/` — ライセンス発行/検証・ルート・webhook（柱3テストを移植）
