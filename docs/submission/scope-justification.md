# OAuthスコープ利用理由書ドラフト（sensitive審査提出用）

対象: 「見積書・請求書メーカー for Google Sheets」（quote-invoice-maker）
スコープは **CR-3 の4点固定**（`docs/setup/gcp-oauth.md §3`・CIで差分ガード済み）。
文言は `web/privacy.html` のスコープ表と整合させてある（審査時はPP・本理由書・実挙動の三者一致が重要）。
提出フォームへは日本語欄が無い場合に備え英語訳を併記する。**restrictedスコープは使用しない**（CASA非対象）。

## アプリ概要（フォームの App functionality 欄）

日本語: 本アドオンは、フリーランス・個人事業主がスプレッドシート上で見積書・請求書を作成し、消費税・源泉所得税を自動計算し、A4のPDFとして生成して、実務的なファイル名（YYYYMMDD_取引先名_税込金額.pdf）で利用者のGoogle Driveへ保存するエディタアドオンです。書類データの処理は利用者のGoogleアカウント内（スプレッドシートとDrive）で完結し、書類の内容を運営側サーバへ送信しません。

English: This editor add-on lets freelancers and sole proprietors create quotes and invoices inside Google Sheets, automatically calculates consumption tax and Japanese withholding tax, generates an A4 PDF, and saves it to the user's own Google Drive with a practical file name (YYYYMMDD_ClientName_Amount.pdf). All document data is processed within the user's Google account (the spreadsheet and Drive); document contents are never sent to our servers.

## スコープ別の用途と最小性

### 1. `https://www.googleapis.com/auth/spreadsheets.currentonly`（sensitive）

- **用途（PP整合）**: お客様が開いているスプレッドシートに入力シート・帳票・台帳を作成し読み書きするため。他のスプレッドシートにはアクセスしません。
- **具体的機能**: 書類入力シートの生成（FR-1）、見積→請求変換（FR-2）、計算結果・根拠注記の書き込み（FR-3/4）、帳票シートへの差し込み（FR-5/6）、出力台帳への追記（FR-12）。
- **最小性**: 全ファイル対象の `spreadsheets` ではなく、**現在開いているスプレッドシートのみ**にアクセスできる currentonly を採用。アドオンの機能は利用者が開いている1ファイルの中で完結するため、これで十分である。
- English: Used to create and update the document-input sheets, the print template sheet, and the output ledger **in the spreadsheet currently open by the user**. We deliberately chose `spreadsheets.currentonly` instead of the broader `spreadsheets` scope because the add-on never needs to access any other spreadsheet.

### 2. `https://www.googleapis.com/auth/script.external_request`（sensitive）

- **用途（PP整合）**: PDF生成（GoogleのエクスポートAPI）とライセンス検証（送信先を固定）のため。
- **具体的機能**: ①帳票シートをA4 PDF化するため、Google自身のスプレッドシートexportエンドポイント（`https://docs.google.com/`）を利用者自身のOAuthトークンで呼び出す（FR-7）。②有料プランのライセンスキー検証のため、運営のライセンスサーバへ**キー文字列のみ**を送信する（FR-10）。
- **最小性**: manifest の `urlFetchWhitelist` で送信先を上記2ドメインに固定している。スプレッドシートの内容（明細・取引先名・金額）はいかなる外部にも送信しない（無料利用の範囲では外部送信ゼロ）。
- English: Used only for (1) calling Google's own spreadsheet PDF export endpoint (`https://docs.google.com/`) with the user's own OAuth token, and (2) sending **only the license key string** to our license server for paid-plan verification. Destinations are pinned via `urlFetchWhitelist`. Spreadsheet contents are never transmitted.

### 3. `https://www.googleapis.com/auth/script.container.ui`（非sensitive）

- **用途（PP整合）**: 操作用のサイドバーUIを表示するため。
- **具体的機能**: 書類作成・再計算・PDF出力などの操作と、使用量・ライセンス状態・ヘルプの表示を行うサイドバー（FR-9/14ほか）。
- **最小性**: エディタアドオンのUI表示に必要な標準スコープであり、これ以外のUI手段はない。
- English: Required to show the add-on's sidebar UI (the only user interface of the add-on).

### 4. `https://www.googleapis.com/auth/drive.file`（sensitive・非restricted）

- **用途（PP整合）**: 生成したPDFを保存するフォルダ（「帳票」）の作成と、PDFファイルの保存のため。**本アドオンが作成したファイル・フォルダ以外にはアクセスできない権限です。**
- **具体的機能**: 保存フォルダ「帳票」（配下に「請求書」「見積書」）の作成と、生成PDFの保存・同名衝突チェック（FR-8）。
- **最小性**: Drive全体にアクセスできる `drive`（restricted）ではなく、**アプリが作成したファイル/フォルダに限定される** drive.file を採用。利用者の既存のDriveファイルには一切アクセスできない。
- English: Used to create the add-on's own output folder ("帳票" with "請求書"/"見積書" subfolders) and save the generated PDFs into it. We use `drive.file` — which grants access **only to files and folders created by this app** — instead of the restricted full-Drive scope. The add-on can never read the user's existing Drive files.

## データ取扱いの補足（審査で問われやすい点）

- 書類データ（明細・取引先名・金額）は利用者のスプレッドシートとDriveの外へ送信しない。運営バックエンドはライセンスの発行・検証のみを行うステートレス構成で、利用者の書類データ・利用量データを保存しない（詳細: `web/privacy.html`）。
- 決済情報はStripeが管理し、運営側でカード情報を保持しない。
- 本アドオンは登録番号（T番号）の照会・真正性検証を行わない（入力欄の形式チェックのみ）。

## 提出時チェックリスト（人間タスク）

- [ ] OAuth同意画面のスコープ宣言が上記4点のみと一致している（`docs/setup/gcp-oauth.md §3`）
- [ ] PP公開URL（`https://<サブドメイン>/privacy.html`）のスコープ表と本理由書の文言が一致している
- [ ] デモ動画（`docs/submission/demo-video-script.md`）で4スコープすべての実使用シーンが映っている
- [ ] 提出前に本ドラフトをフォームの文字数制限に合わせて要約する（各スコープ数百字程度が目安）
