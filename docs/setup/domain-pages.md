# 公開URL（サブディレクトリ方式）・GitHub Pages セットアップ手順（引継書§5・§12-0）

LP・プライバシーポリシー・利用規約・特商法表記の公開は、Google OAuth ブランド確認の前提条件。
本製品の公開URLは、柱3ドメインの**サブディレクトリ方式**で確定:
**`https://pelmoalabs.com/quote-invoice-maker/`**
（当初第一候補だったサブドメイン方式 `invoice.<domain>` から変更。GitHub Pages は
「ユーザーサイトのカスタムドメイン配下に各プロジェクトサイトが `/<リポジトリ名>/` で載る」
性質を使い、DNS追加・CNAME割当なしで公開できるため）。

作業完了ごとにチェックを入れ、確定値は末尾に記録し、`docs/decisions.md` に1行残すこと。

## 前提・禁止事項

- 公開する静的ファイルは `web/` 配下。デプロイは `.github/workflows/pages.yml`
  （`web/**` の push または手動実行でトリガー。GitHub Pages 有効化済み・build_type=workflow）。
- **`web/CNAME` は作成禁止**。本リポジトリの Pages 設定にもカスタムドメインを入力しない
  （プロジェクトサイトにカスタムドメインを設定するとサブディレクトリ方式と競合する。
  ドメインの割当は pelmoalabs.com 側の設定にのみ従う）。
- **web/ 内のリンク・アセット参照はすべて相対パス**（`href="privacy.html"` / `assets/style.css`）。
  ルート絶対パス（`/privacy.html` 等）は `pelmoalabs.com/quote-invoice-maker/` 配下で壊れるため禁止。
  現状の6ページはすべて相対パスで統一済み。

## 1. GitHub Pages（本リポジトリ側）

- [x] Settings → Pages → Source = **GitHub Actions**（2026-07-11 有効化済み・decisions.md）
- [ ] `https://minako-ph.github.io/quote-invoice-maker/` で表示確認（相対パスのためこのURLでも全ページ動作する）

## 2. pelmoalabs.com 配下への露出（サブディレクトリ）

- [ ] 柱3（company-list-cleaner）側の Pages に `pelmoalabs.com` が割当済みであることを確認
      （割当済みなら、同一アカウントの本プロジェクトサイトは自動的に
      `https://pelmoalabs.com/quote-invoice-maker/` で配信される。DNS追加は不要）
- [ ] **Worker ROUTES の解除確認**: Cloudflare ダッシュボード → Workers & Pages →
      jp-business-api（または pelmoalabs.com にルートを張っている Worker）→
      Settings → Domains & Routes を確認し、`pelmoalabs.com/*` のような
      **`/quote-invoice-maker/*` を覆うルートがあれば解除**（またはAPI用サブパス／サブドメインに限定）する。
      Worker がパスを握ったままだと Pages に到達せず 404/API応答になる。
- [ ] 確認: `curl -sI https://pelmoalabs.com/quote-invoice-maker/` が 200 で
      `content-type: text/html` を返すこと（Workerの応答やリダイレクトでないこと）

## 3. HTTPS

- [ ] `https://pelmoalabs.com/quote-invoice-maker/` がHTTPSで表示されること
      （証明書は pelmoalabs.com（柱3側）の設定に従うため、本リポジトリ側の作業はない）

## 4. Search Console 所有権確認

- [ ] 柱3側で `pelmoalabs.com` の**ドメインプロパティ（DNS TXT確認）**が済んでいることを確認
      （サブディレクトリは当然に包含される。追加作業なし）

## 5. 公開後の確認

- [ ] `https://pelmoalabs.com/quote-invoice-maker/` で LP 表示（タイトルはアプリ名のみ＝審査対策）
- [ ] `privacy.html` `terms.html` `tokushoho.html` `thanks.html` `license-recover.html` が
      同ディレクトリ配下で表示され、ページ間リンク（相対パス）が切れていない
- [ ] `docs/setup/gcp-oauth.md` の OAuth 同意画面に各URL
      （`https://pelmoalabs.com/quote-invoice-maker/privacy.html` 等）を記入
- [ ] Stripe Checkout の成功URLを
      `https://pelmoalabs.com/quote-invoice-maker/thanks.html?session_id={CHECKOUT_SESSION_ID}` に設定
      （backend/README.md）
- [ ] backend デプロイ後、`thanks.html` / `license-recover.html` の `BACKEND_URL` プレースホルダを実URLへ差替

## 確定値

| 項目 | 値 |
|---|---|
| ドメイン | pelmoalabs.com（柱3と共用・柱3側で取得済み） |
| 本製品の公開URL | https://pelmoalabs.com/quote-invoice-maker/ （サブディレクトリ方式） |
| `web/CNAME` | **作成しない**（禁止。ドメイン割当は柱3側の設定に従う） |
| HTTPS | pelmoalabs.com 側の設定に従う |
| Search Console 所有権確認 | 柱3ドメインプロパティに包含 |
| Worker ROUTES 解除 | TODO（実施日と設定内容を decisions.md へ） |
