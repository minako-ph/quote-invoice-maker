# 独自ドメイン（サブドメイン共用）・GitHub Pages 公開 セットアップ手順（引継書§5・§12-0）

LP・プライバシーポリシー・利用規約・特商法表記の公開は、Google OAuth ブランド確認の前提条件。
本製品は**柱3（company-list-cleaner）の独自ドメインのサブドメイン共用が第一候補**
（例: `invoice.<domain>`。引継書§5）。作業完了ごとにチェックを入れ、確定値は末尾に記録し、
`docs/decisions.md` に1行残すこと。

## 前提

- 公開する静的ファイルは `web/` 配下（`index.html` / `privacy.html` / `terms.html` /
  `tokushoho.html` / `thanks.html` / `license-recover.html` / `assets/style.css`）。
- デプロイは `.github/workflows/pages.yml`（`web/**` の push または手動実行でトリガー）。
- **GitHub Pages はカスタムドメイン1つ=1サイト**。柱3が apex を使う場合、本リポジトリの Pages には
  サブドメインを CNAME 割当する（引継書§5）。

## 0. 柱3ドメインの状況確認（§12-0。人間・並行）

- [ ] 柱3の独自ドメイン取得状況を確認する（取得済みならドメイン名を控える）
- [ ] サブドメイン方針を仮決めする（第一候補: `invoice.<domain>`）
- [ ] 柱3が apex / www のどちらを Pages に割当てているか確認する

## 1. GitHub Pages を有効化（本リポジトリ）

- [ ] GitHub リポジトリ → Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定
- [ ] `master` ブランチへ `web/**` を push すると `pages.yml` が走り、`web/` がそのまま公開される
- [ ] まずは `https://<user>.github.io/quote-invoice-maker/` で表示確認（独自ドメイン設定前）

## 2. サブドメインの CNAME / DNS 設定（ドメイン確定後）

- [ ] GitHub リポジトリ → Settings → Pages → Custom domain に `invoice.<domain>` を入力して保存
- [ ] **`web/CNAME` ファイルを追加する**: 内容は `invoice.<domain>` の1行のみ。
      `web/` 配下に置くことで artifact に含まれ、デプロイ時に反映される。
      **本タスク時点ではドメイン未確定のため未作成。**
- [ ] DNS（柱3ドメインと同じプロバイダ）に CNAME レコードを追加:
      `invoice.<domain>` → `<user>.github.io`

## 3. HTTPS 有効化

- [ ] DNS 伝播後、Settings → Pages → **Enforce HTTPS** にチェック
  - 証明書の自動発行に数分〜24時間かかる場合がある。チェックできない場合は伝播待ち。

## 4. Search Console 所有権確認

- [ ] 柱3側で**ドメインプロパティ（DNS TXT確認）**が済んでいれば、サブドメインは包含されるため
      追加作業は不要（引継書§5）。未確認なら apex のドメインプロパティで所有権確認を行う。

## 5. 公開後の確認

- [ ] `https://invoice.<domain>/` で LP 表示
- [ ] `/privacy.html` `/terms.html` `/tokushoho.html` `/thanks.html` `/license-recover.html` が表示される
- [ ] `docs/setup/gcp-oauth.md` の OAuth 同意画面に各 URL を記入
- [ ] Stripe Checkout の成功URLを `https://invoice.<domain>/thanks.html?session_id={CHECKOUT_SESSION_ID}` に設定（backend/README.md）
- [ ] backend デプロイ後、`thanks.html` / `license-recover.html` の `BACKEND_URL` プレースホルダを実URLへ差替

## 確定値（決まり次第記入し、decisions.md に1行残す）

| 項目 | 値 |
|---|---|
| 柱3ドメイン | TODO |
| 本製品サブドメイン | TODO（候補: invoice.<domain>） |
| `web/CNAME` 追加済みか | TODO（未・ドメイン確定後に追加） |
| HTTPS 有効化 | TODO |
| Search Console 所有権確認 | TODO（柱3ドメインプロパティに包含見込み） |
