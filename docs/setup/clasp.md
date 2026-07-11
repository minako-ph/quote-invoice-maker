# clasp 疎通セットアップ手順（引継書§12・柱3手順書の本製品版）

コード側の準備（workspace・esbuildビルド・CI・スコープチェック）は実装済み。ここは認証が必要なため手動で行う。

前提: node 22.17.0（`.node-version`）、pnpm 11.10.0。OAuthスコープは **CR-3 の4点固定**（`apps-script/appsscript.json`）。

## チェックリスト

- [ ] 依存インストール: リポジトリルートで `pnpm install`
- [ ] clasp ログイン: `pnpm --filter apps-script exec clasp login`
      （ブラウザが開き Google 認証。公開に使うアカウントで実施）
- [ ] テスト用スプレッドシートを作成（Google ドライブで新規シート。任意の名前でよい）
- [ ] standalone スクリプトを用意する（どちらか）:
  - 新規作成する場合:
    `pnpm --filter apps-script exec clasp create --type standalone --title "見積書・請求書メーカー(dev)" --rootDir dist`
    → 生成された `.clasp.json`（gitignore 済み）の `rootDir` が `dist` になっていることを確認
    （柱3実績: アドオンは standalone スクリプトとして作成する。コンテナバインドにはしない）
  - 既存の standalone スクリプトを使う場合:
    `apps-script/.clasp.json.example` をコピーして `apps-script/.clasp.json` を作成し
    `scriptId` を実値に、`rootDir` は `dist` のままにする
- [ ] ビルド＆push: `pnpm --filter apps-script push`
      （内部で `pnpm build`＝esbuild バンドル → `dist/` に Code.js / appsscript.json / sidebar.html を生成 → `clasp push`）
- [ ] サイドバー疎通を確認する:
      GAS エディタ →「デプロイ」→「デプロイをテスト」→ エディタアドオンとして
      テスト用スプレッドシートにインストールする
- [ ] メニュー「見積書・請求書メーカー」→「サイドバーを開く」でサイドバーが開き、
      使用量（0/3枚）とライセンス状態（未登録）が表示されることを確認
      → これで GAS ⇄ サイドバー（`google.script.run getSidebarInit`）の疎通が確認できる
- [ ] サイドバーの「サンプルで試す」でサンプル見積書シートが生成されることを確認
- [ ] **V-1/V-2 スパイクを実行する**（`docs/setup/spike-v1-v2.md`。約10分）→ 結果を decisions.md へ
- [ ] スパイク成立後、サンプル書類で「プレビュー/再計算 → 見積→請求変換 → PDF出力・保存」の
      E2E を通し、Drive「帳票」フォルダと台帳シートを確認する

## 注意

- `.clasp.json` は認証・スクリプトID を含むため gitignore 済み。コミットしない（雛形は `.clasp.json.example`）。
- スコープを4点から増やさない（CR-3）。`push` 後も `node scripts/check-oauth-scopes.mjs` で `dist/appsscript.json` を検証できる。
- Marketplace 公開にはデフォルトプロジェクトから**GCP標準プロジェクトへの紐付け**が必要。手順は `docs/setup/gcp-oauth.md §4` を参照。
- Marketplace SDK には**版指定デプロイ（HEADではない）**を紐付ける（柱3実績・引継書§5）。審査後の更新は新しい版のデプロイ→SDK側の版切替で行う。
- バックエンド（Cloud Run）デプロイ後は、GAS の Script Properties `BACKEND_URL` を設定し、
  `appsscript.json` の `urlFetchWhitelist` に同URLを追記して再 push する（backend/README.md 参照）。
