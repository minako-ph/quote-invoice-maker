# GCPプロジェクト・OAuth同意画面 セットアップ手順（引継書§5・柱3手順書の本製品版）

審査実務に対応する手動チェックリスト。**スコープは CR-3 の4点固定**。作業完了ごとにチェックを入れ、
確定値（プロジェクトID等）を本ファイル末尾の「確定値」に記録し、decisions.md に1行残すこと。

## 前提

- Googleアカウント: 公開に使うアカウント（柱3と同一アカウント推奨）で実施。
- 公開URLは柱3ドメインの**サブディレクトリ方式**で確定:
  `https://pelmoalabs.com/quote-invoice-maker/`（docs/setup/domain-pages.md）。
  LP/PP/ToS の公開が**ブランド確認の前提**。

## 1. GCPプロジェクト作成

- [ ] https://console.cloud.google.com/projectcreate で新規プロジェクト作成
  - プロジェクト名: `quote-invoice-maker`（プロジェクトIDは自動採番でよい。確定値に記録）
  - 組織なし（個人）で可。課金アカウントの紐付けは Cloud Run デプロイ時でよい

## 2. OAuth同意画面（外部・テストモード）

- [ ] コンソール → 「APIとサービス」→「OAuth同意画面」
- [ ] User Type: **外部（External）** を選択
- [ ] アプリ情報:
  - アプリ名: `見積書・請求書メーカー`（Marketplace掲載名と整合。marketing §5 が正）
  - ユーザーサポートメール: 運用アカウントのメール
  - デベロッパー連絡先: 同上
- [ ] アプリドメイン:
  - ホームページ: `https://pelmoalabs.com/quote-invoice-maker/`
  - プライバシーポリシー: `https://pelmoalabs.com/quote-invoice-maker/privacy.html`
  - 利用規約: `https://pelmoalabs.com/quote-invoice-maker/terms.html`
- [ ] 承認済みドメインに `pelmoalabs.com` を追加（**Search Consoleでの所有権確認が前提**。
      柱3のドメインプロパティ（DNS確認）が済んでいればサブディレクトリは当然に包含される）
- [ ] 公開ステータス: **テスト中（Testing）** のまま。テストユーザーに自分のアカウントを追加

## 3. スコープ宣言（CR-3: この4点以外を絶対に追加しない）

- [ ] 「スコープを追加または削除」で以下の4点**のみ**を宣言:
  - `https://www.googleapis.com/auth/spreadsheets.currentonly`
  - `https://www.googleapis.com/auth/script.external_request`
  - `https://www.googleapis.com/auth/script.container.ui`
  - `https://www.googleapis.com/auth/drive.file`
- [ ] sensitive審査（1〜3週）はP3の提出物が揃ってから提出（スコープ利用理由書＋デモ動画が必要）。
      **restrictedスコープが無いため CASA は発生しない**（drive.file は非restricted＝引継書§5）。

## 4. Apps Scriptプロジェクトとの紐付け（clasp疎通後）

- [ ] Apps Scriptエディタ → プロジェクトの設定 → 「Google Cloud Platform（GCP）プロジェクト」→
      上記プロジェクト番号を設定（デフォルトプロジェクトから標準プロジェクトへ切替。Marketplace公開の必須条件）
- [ ] コンソール側で「Apps Script API」を有効化
- [ ] （本製品固有）Advanced Drive Service を使うため「Google Drive API」を有効化

## 5. 後続（審査提出物が揃ってから。ここではやらない）

- ブランド確認（2〜3営業日）: ホームページ・PP URL・Search Console所有権確認が揃ってから申請
- sensitive審査 → Marketplace SDK設定（**版指定デプロイ**を紐付け。HEAD不可）→ 掲載審査

## 確定値（決まり次第記入し、decisions.mdに1行残す）

| 項目 | 値 |
|---|---|
| GCPプロジェクトID | TODO |
| GCPプロジェクト番号 | TODO |
| OAuth同意画面ステータス | TODO（未着手／テスト中／審査中） |
