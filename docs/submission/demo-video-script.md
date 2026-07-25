# デモ動画撮影台本 v2（sensitive審査提出用・2026-07-25版）

対象: 「見積書・請求書メーカー for Google Sheets」／想定尺: **3〜4分**（受入基準§9-5の実測約1分の動線を丁寧になぞる）
目的: 4スコープすべての実使用シーンと、OAuth同意画面のスコープ一致を審査員に見せる。
撮影条件: 画面録画（1080p以上・日本語UI）。**未認可状態から**録る（同意画面の収録が必須）。
字幕: 審査員向けに**日英併記**（日本語ナレーション＋English subtitle。各シーンに記載）。

## スコープ対応表（GCPコンソール実測区分・2026-07-25）

| シーン | 見せる操作 | 使用スコープ | 区分 |
|---|---|---|---|
| 1 | サイドバー表示 | script.container.ui | 機密（sensitive審査対象） |
| 2 | シート生成・書込 | spreadsheets.currentonly | 非機密 |
| 3 | PDF export・ライセンス検証導線 | script.external_request | 機密（sensitive審査対象） |
| 3・4 | 「帳票」フォルダ作成・PDF保存 | drive.file | 非機密・非restricted |

## シーン0: 事前準備（映さない）

1. **権限リセット**: https://myaccount.google.com/connections （Googleアカウント →
   セキュリティ → サードパーティ製のアプリとサービス）で本アドオンのアクセス権を**削除**し、
   未認可状態に戻す（シーン1で同意画面を必ず出すため）。
2. **プロパティ初期化**: 発行者プロファイル未設定・当月使用量0の状態にする
   （テスト用アカウントを新規に使うのが確実。(dev)リセット機能は版指定デプロイ前に削除済み）。
3. Driveの「帳票」フォルダを削除しておく（フォルダ自動作成のシーンを見せるため）。
4. **ダミープロファイル注意**: 実在の氏名・住所・口座・取引先を一切映さない。使用するダミー値:
   - 氏名/名称: `デモ 太郎`／住所: `東京都千代田区1-1-1`／登録番号: `T1234567890123`
   - 振込先: `〇〇銀行 〇〇支店 普通 1234567`／取引先: `サンプル株式会社`（FR-13サンプル）
5. テスト用スプレッドシートを新規作成し、アドオンをテストデプロイでインストール可能にしておく。

## シーン1: 起動とOAuth同意（0:00〜0:40）［container.ui／スコープ一致の提示］

1. スプレッドシートを開き、拡張機能 → 見積書・請求書メーカー →「サイドバーを開く」。
2. 権限承認ダイアログを**スクロール含め全文**映す。
   - ★審査ポイント: 表示スコープが申請どおり**4点のみ**（現在のスプレッドシート／外部サービスへの接続／サイドバーUI／このアプリで作成したDriveファイル）。
3. 承認後、サイドバーが開く（container.ui の実使用）。
   - 字幕(日): 「操作はすべてサイドバーから。要求する権限はこの4点だけです」
   - Subtitle (EN): "Everything runs in this sidebar. These four scopes are all we request."

## シーン2: プロファイル設定とサンプル生成（0:40〜1:30）［spreadsheets.currentonly］

1. 「発行者プロファイル」を開き、シーン0のダミー値を入力して保存。
2. 「サンプルで試す」→ サンプル見積書シートが**現在のスプレッドシート内に**生成される。
   - ★審査ポイント: currentonly の実使用（開いているファイルにのみシート作成・書込）。
   - 字幕(日): 「アクセスするのは、いま開いているスプレッドシートだけです」
   - Subtitle (EN): "The add-on only touches the spreadsheet that is currently open — nothing else."

## シーン3: 再計算とPDF出力・Drive保存（1:30〜2:30）［external_request／drive.file］

1. 「プレビュー / 再計算」→ 集計と計算根拠の注記（適用税率・端数処理・源泉税の式）を映す。
2. 「PDF出力・Driveに保存」→ 成功メッセージ（`YYYYMMDD_サンプル株式会社_….pdf`＋リンク）。
   - ★審査ポイント: external_request は Google 自身の export API を**利用者自身のトークン**で
     呼ぶだけ（送信先は urlFetchWhitelist で docs.google.com とライセンスサーバに固定。
     シートの中身は運営サーバへ送信しない）。
   - 字幕(日): 「PDFはGoogleのエクスポート機能で生成。書類の中身が運営者に送られることはありません」
   - Subtitle (EN): "PDFs are generated via Google's own export endpoint with the user's token. Document contents never reach our servers."
3. リンクからDriveを開き、「帳票 → 見積書」フォルダにPDFがあることを映す。
   - ★審査ポイント: drive.file の実使用（**アプリが作成した**フォルダ/ファイルのみ。既存ファイルには触れない）。
   - 字幕(日): 「保存先はアドオン自身が作ったフォルダだけ。既存のDriveファイルにはアクセスできません」
   - Subtitle (EN): "Files are saved only into folders this add-on created. It cannot access any of your existing Drive files."

## シーン4: 見積→請求変換・台帳・クロージング（2:30〜3:30）

1. サンプル見積書シートで「見積書 → 請求書に変換」→ 明細・取引先を引き継いだ請求書シートが生成される。
2. そのまま「PDF出力・Driveに保存」→ 成功メッセージ →「帳票 → 請求書」フォルダと
   「台帳」シート（発行日・種別・番号・取引先・金額・リンクの自動記帳）を映す。
   - 字幕(日): 「見積から請求、PDF、命名保存、台帳記帳までワンクリックずつ」
   - Subtitle (EN): "Quote to invoice, PDF, e-bookkeeping-friendly file names, and a ledger — one click each."
3. サイドバーの使用量表示（今月の出力 2/3枚）とヘルプの「できないこと（正直な明記）」を短く映す。
   - 字幕(日): 「無料で月3枚まで。データが外に出ることはありません」
   - Subtitle (EN): "Free for up to three PDFs per month. Your data stays in your Google account."

## 撮影後チェックリスト

- [ ] OAuth同意画面の4スコープが判読できる解像度で映っている
- [ ] 4スコープすべての実使用シーンがある（UI表示／シート書込／PDF export／Drive保存）
- [ ] 実在の個人情報・実顧客名が映っていない（シーン0のダミー値のみ）
- [ ] 日英字幕が全シーンに入っている
- [ ] 尺が5分以内（目標3分台）
- [ ] 動画URL（限定公開YouTube等）を審査フォームに記載

## 備考

- スクリーンショット5枚（marketing §5・listing-copy.md のキャプション対応）は同じ撮影データで
  併せて取得すると効率的。
- 撮影は**版指定デプロイ相当のビルド**（(dev)メニューなし・2026-07-25クリーンアップ後）で行うこと。
