# decisions.md — 実装中の判断ログ（1行/件、新しいものを上に）

- 2026-07-11 F-1: CORSは/license/claim・/license/recoverの2ルートのみ許可（origin '*'・credentialsなし。認可の実体はsessionId/email＋IPクールダウンでありCORSは境界ではない）。verify=GASサーバ間・webhook=Stripeサーバのため付けない。未設定時503分岐より前にuse登録
- 2026-07-11 GitHub Pages を有効化（build_type=workflow・gh api）。暫定URL https://minako-ph.github.io/quote-invoice-maker/ 。カスタムドメイン（サブドメインCNAME）はドメイン確定後（domain-pages.md）
- 2026-07-11 web/thanks・license-recover は柱3の型を移植（`BACKEND_URL=''`プレースホルダ＋未設定時「準備中」表示）。BACKEND_URL・購入URL（sidebar.html `CHECKOUT_URL`/`RECOVER_URL`）はデプロイ後に人間が差替（TODO）
- 2026-07-11 backend dist起動スモーク合格: `pnpm --filter backend build` → `node dist/index.js` 起動・`GET /health`={ok:true}・未設定時`/license/verify`=503 を確認（柱3のERR_UNKNOWN_FILE_EXTENSION事故の再発なし）
- 2026-07-11 backend は柱3 `company-list-cleaner` コミット `b51671894689c8eb6c493603c2099ffea4ebf09c` からのコピー移植（本リポジトリで改変自由・柱3側は不介入）。iss=`quote-invoice-maker`／aud=`quote-invoice-maker-license` の別鍵分離、Firestore/quota/公的API/監視系は構成ごと削除、env は STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/LICENSE_SIGNING_KEY/PORT の4点のみ
- 2026-07-11 urlFetchWhitelist は `https://docs.google.com/` のみで開始（BACKEND_URL未確定のため）。Cloud RunデプロイURL確定後に追記して再push（TODO・docs/setup/clasp.md）
- 2026-07-11 Advanced Drive Service は Drive API **v3**（userSymbol `Drive`）で manifest 宣言。V-2スパイク（driveProbe）も同経路で検証する
- 2026-07-11 calc.ts の端数処理は「整数の積÷10^n」に正規化してから floor/round/ceil（float誤差で±1円ずれる事故の構造的回避。golden G-1〜G-11全緑）
- 2026-07-11 書類番号は `prefix+Q/I-連番4桁`（DocumentProperties採番・手動上書き可）で最小実装（FR-1の採番形式は未定義だったため）
- 2026-07-11 支払期限（請求書）/有効期限（見積書）は自由入力欄（B7）として最小実装（既定値の自動計算は入れない。要望が出たらv1.1判断）
- 2026-07-11 源泉トグルは入力シートB9のチェックボックス（書類単位・既定はプロファイル設定値=FR-4）。見積→請求変換時は見積側の状態を引き継ぐ
