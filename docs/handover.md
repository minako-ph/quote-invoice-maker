# quote-invoice-maker Claude Code引継書 v1.0 —「見積書・請求書メーカー」実装ハンドオーバー

作成日: 2026-07-11 ／ 対文書: **requirements.md v1.0（要件の正）**、marketing.md v1.0（掲載文言の正）
本書の目的: 要件定義フェーズで確定した設計・検証済みファクト・戦略文脈を欠落なく引き継ぎ、実装者（Claude Code）が文脈の再質問なしに「コード＋テスト完了・審査提出物準備済み」（週末のDone）まで到達できるようにする。

---

## 0. 読み方

§1〜2が「なぜこの形か」、§3〜10が「どう作るか」、§11〜12が「どの順で・何をもって完了か」。**§13のDo/Don'tは絶対規則**。未定義事項は最小実装＋TODOで前進し、`docs/decisions.md`に1行残す。要件書と本書が矛盾したら要件書。週末ゴール: **7/12までにコード＋テスト完了、残りは人間手作業のみ**。

## 1. プロジェクト文脈

- 事業主はソロ開発者（TypeScript×GASが本職の得意領域）。制約: 週1時間保守／能動マーケなし／受託なし。「検討より出荷」。
- **既存4本（柱1 jp-tender-intel・柱2 jp-opendata-actors・柱3 company-list-cleaner・入札ウォッチSaaS）の週明け人間作業を本プロダクトがブロックしない。競合したら常に既存を優先する。**
- 本製品は市場調査レポートv2.0 A-2の週末プロダクト②。柱3「会社リストクリーナー」の**隣接製品**であり、顧客場面を分離する: 本製品=「発行のたびのトランザクション処理」、柱3=「リストの一括整備」。共食い禁止がCR-1の背景。
- 選定根拠: 同型GASアドオン（BudgetSheet、100% Apps Script製）が$1.6k MRRを実証／無料の請求書生成GASツールに源泉税対応等の継続的な機能要望あり／源泉税・インボイス様式・電帳法命名を統合した高品質日本語アドオンは希少／柱3の課金・審査資産の流用で限界コストが最小。

## 2. 柱3からの流用と製品分離の設計（最重要のWhy）

- 流用元: `minako-ph/company-list-cleaner` **コミット `b51671894689c8eb6c493603c2099ffea4ebf09c`**（本要件定義時にcloneして全ファイル検証済み）。
- 流用対象: (a) backendのライセンス実装一式（§7） (b) apps-scriptのビルド/テスト構成（esbuild単一バンドル＋ENTRY_POINTSのfooterスタブ、clasp rootDir=dist、pnpm 11.10.0／Node 22.17.0） (c) CI（スコープ差分チェックをビルド前後2回） (d) web/の構成（LP/PP/ToS/特商法/thanks/license-recover、`const BACKEND_URL=''`プレースホルダ＋未設定時「準備中」型） (e) 審査手順書の型（docs/setup/gcp-oauth.md・domain-pages.md・clasp.md）。
- **コピー移植であってsubtreeではない**: 本リポジトリ内で改変自由。出所コミットを`docs/decisions.md`に1行記録する。柱2 packagesのsubtree規律（改変禁止・還元→再取込）はここには適用しない。**柱3リポジトリには一切手を入れない**（審査クリティカルパスの保護）。柱2のgov-clients等も取り込まない（照会機能を持たないため不要）。
- **製品分離の根拠（clone検証で確認済みの事実）**: 柱3の`verifyLicenseKey`は「顧客の任意の有効購読でvalid」を返す製品非対応実装（`SubscriptionInfo`にprice/product情報が無い）。同一鍵・同一バックエンドを共用するとProキーが製品間で相互解錠される。よって本製品は**別のEd25519鍵ペア＋`iss='quote-invoice-maker'`／`aud='quote-invoice-maker-license'`**で発行し、別デプロイにする。Stripeは同一アカウントに新Product/Price（¥1,480税込）。
- 無料枠カウントは**クライアント側（UserProperties）**に置き、バックエンドを**ライセンス専用（ステートレス・Firestore不使用）**に縮小する。これによりN-3「無料利用ではシート外へのデータ送信ゼロ」が成立する（審査・訴求の両方で効く）。

## 3. 確定アーキテクチャ

```
[利用者のGoogle Sheet]
   ↕ (spreadsheets.currentonly)
[GASアドオン（standaloneスクリプト＋版指定デプロイ）]
   ├─ 入力シート（1書類=1シート）／台帳シート
   ├─ 計算エンジン calc.ts（純関数・golden対象・唯一の計算源）
   ├─ 帳票描画: アプリ作成の作業スプレッドシート（scratch.ts・1ユーザー1つ）＋Sheets Advanced Service v4 batchUpdate（V-1確定）
   ├─ PDF生成: 作業ファイルの export URL＋OAuthトークン（V-1確定）
   ├─ Drive保存: Advanced Drive Service v3／drive.file（V-2確定）
   ├─ 無料枠: UserProperties月次カウンタ（LockService保護）
   └─ ライセンス: キーをUserProperties保存→/license/verify照会
        ↓ HTTPS (script.external_request／urlFetchWhitelist)
[ライセンス専用バックエンド: Cloud Run（Hono+TS、asia-northeast1、max-instances=1／min=0、ステートレス）]
   ├─ /license/claim  /license/verify  /license/recover
   ├─ /stripe/webhook（署名検証のみ・保存なし・冪等）
   └─ /health
[Stripe]（Checkout/Payment Link・カスタマーポータル・webhook）
```

バックエンドが必要な最小理由: Stripe秘密鍵の秘匿・webhook受信・キー発行/検証。**それ以外の状態・機能を持たない**（公的API・Firestore・監視トラッカーは無し）。

## 4. リポジトリ構成（新規: `quote-invoice-maker`、pnpm workspace）

```
quote-invoice-maker/
├── apps-script/            # clasp（TypeScript→esbuild→単一Code.js。柱3 build.mjsを移植）
│   ├── src/server/         # main / sidebarApi / calc / layout / sheets / template / pdf / drive / naming / quota / license / profile / ledger / sample
│   ├── src/sidebar/sidebar.html
│   └── appsscript.json     # §5の4スコープ・timeZone Asia/Tokyo・urlFetchWhitelist・（V-2確定後）Drive Advanced Service
├── backend/                # Cloud Run（Hono+TS）ライセンス専用。柱3からコピー移植（§7）
│   └── src/{routes/{license,stripeWebhook}, services/{license,stripeGateway}, app.ts, config.ts, index.ts}
├── web/                    # LP・privacy・terms・特商法・thanks・license-recover（サブドメインでGitHub Pages公開）
├── docs/{requirements.md, handover.md, marketing.md, decisions.md}
├── scripts/check-oauth-scopes.mjs   # 柱3から移植し4点版に更新
└── .github/workflows/{ci.yml, pages.yml}   # ci=柱3同型（scope check→typecheck→test→build→scope check）
```

## 5. OAuthスコープと審査実務（CR-3の実装）

`appsscript.json`の`oauthScopes`は以下の**4点固定**。CIのスコープ差分チェック（ソースとdistの2回）で増設を拒否する:
- `https://www.googleapis.com/auth/spreadsheets.currentonly`
- `https://www.googleapis.com/auth/script.external_request`
- `https://www.googleapis.com/auth/script.container.ui`
- `https://www.googleapis.com/auth/drive.file`

審査の実務（柱3の実績知見）: GCPプロジェクト→OAuth同意画面（外部・テスト）→**ブランド確認2〜3営業日**（独自ドメインHP・PP URL・Search Console所有権が前提）→**sensitive審査1〜3週**（スコープ利用理由書＋デモ動画）→Apps Scriptを標準GCPプロジェクトへ紐付け＋Apps Script API有効化→Marketplace SDK（**版指定デプロイ**を紐付け。HEAD不可）→掲載審査。restrictedスコープなし→CASA不発生。drive.fileは非restricted（CASA対象外）。`urlFetchWhitelist`にバックエンドURLと`https://docs.google.com/`を設定し送信先を固定する。

ドメイン: 柱3の独自ドメインの**サブドメイン共用が第一候補**（例: `invoice.<domain>`）。GitHub Pagesはカスタムドメイン1つ=1サイトのため、柱3がapexを使う場合は本リポジトリのPagesにサブドメインをCNAME割当する。Search Consoleのドメインプロパティ（DNS確認）はサブドメインを包含する。確定は人間タスク（§12-0）。

## 6. GAS実装の要点

- clasp＋TypeScript＋esbuild（柱3 `apps-script/build.mjs`を移植: IIFE＋globalName、ENTRY_POINTSごとのトップレベル関数スタブをfooter生成、appsscript.json/sidebar.htmlをdist/へコピー）。素のHtmlService＋`google.script.run`。凝ったフレームワーク不要。
- **シート設計**: 入力シートは1書類=1シート（シート名「請求書_<書類番号>」等）。固定レイアウトで**セル座標は`layout.ts`定数に集約**。ヘッダブロック（種別・書類番号・発行日・取引年月日/期間・宛名・件名・支払期限or有効期限）＋明細20行（品目/数量/単価(税抜)/税率10%・8%・対象外/源泉対象✓）＋集計ブロック（GASが値を書く）＋備考。帳票はコンテナ内ではなく**アプリ作成の作業スプレッドシート**（V-1確定・下記PDF生成節）に出力の都度差し込む。台帳シート「台帳」はFR-12列を追記。
- **計算源はcalc.tsのみ**。シート数式で税計算を二重実装しない（golden単一検証・N-1根拠の一元化のため）。再計算はサイドバーの「プレビュー/再計算」とPDF出力時。
- **計算規則（calc.ts、goldenは要件書§6-6）**: ①明細額=数量×単価を1円未満切捨てで整数化（数量は小数可） ②税率区分ごとに明細額を合計→消費税=区分合計×税率を設定方式で**1回**端数処理（割戻し固定） ③源泉対象額: 税抜=対象行明細額の合計／税込=対象行明細額×(1+行税率)を端数処理せず合算 ④源泉税=対象額に10.21%（100万円超部分は二段階式）を適用し**最後に1回だけ**1円未満切捨て ⑤差引請求額=税込合計−源泉税 ⑥`notes[]`に根拠文字列を生成（N-1。例:「消費税は税率区分ごとに切捨て（1書類につき税率ごとに1回）」「源泉徴収税額＝税抜報酬額×10.21%（100万円超部分は20.42%）・1円未満切捨て」）。
- **PDF生成（V-1・確定＝2026-07-24実測）**: 一次案（コンテナ自身のexport URL）は**HTTP 404で不成立**（ブラウザ同一URLは成功＝4スコープトークンの認可起因）。採用方式=フォールバック(1): **アプリ（drive.file）が作成した帳票作業スプレッドシート（scratch.ts・1ユーザー1つ・「帳票」フォルダ直下・IDはUserProperties）に Sheets Advanced Service（v4 batchUpdate）で帳票を描画**（SpreadsheetApp.openByIdはdrive.file下で不可＝FB(1)②×の実測）→ そのファイルの `https://docs.google.com/spreadsheets/d/{id}/export?format=pdf&...`＋`Authorization: Bearer ScriptApp.getOAuthToken()` でPDF取得（%PDFマジックバイト検査つき）。帳票リクエスト生成は template.ts の純関数 `buildTemplateRequests`。スクラッチ競合はユーザーロック（quota.consumeQuota内で全工程実行）で担保。スコープは4点のまま（CR-3）。
- **Drive保存（V-2・確定＝2026-07-24実測）**: DriveAppは使わない（フルdriveスコープを要求しがち）。**Advanced Drive Service（Drive API v3）**でフォルダ作成（「帳票」→「請求書」「見積書」）とPDFアップロード。フォルダIDはDocumentPropertiesに保持し、消えていたら再作成（trashed判定はfields明示＝F-3）。drive.fileは「アプリが作成したファイル/フォルダ」に読み書き可——実機確認済み。
- **命名（naming.ts・純関数）**: `YYYYMMDD_取引先名_税込金額.pdf`（日付=発行日、金額=税込整数）。取引先名は前後空白・改行/制御文字除去、`/`等の置換のみ（㈱等はそのまま=国税庁例示準拠）。同名衝突は`_2`連番。
- **無料枠（quota.ts）**: UserProperties `usage={month:'YYYY-MM', used:n}`。月キーは`Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM')`。消費は`LockService.getUserLock()`内で「残数確認→PDF保存成功→+1」。月替りで自動リセット。超過はgracefulに停止しPro案内（文言はmarketing §8のverbatim）。
- **ライセンス（license.ts）**: キーはUserProperties保存。検証は`/license/verify`委譲（GAS側でJWTローカル検証をしない＝`LICENSE_PUBKEY`は持たない）。結果は短時間（10分程度）UserPropertiesにキャッシュ。検証不能時はfail-closed（Free扱い）＋サイドバーに状態表示（N-4）。
- **プロファイル（profile.ts）**: FR-11項目をUserPropertiesにJSON保存。登録番号は`/^T\d{13}$/`の形式チェックのみ（チェックデジット・真正性検証のコードを書かない=CR-1）。
- ENTRY_POINTS（build.mjs footer）は実装した`google.script.run`対象と厳密一致させる（目安: onOpen/onInstall/showSidebar/getSidebarInit/createDocument/convertToInvoice/recalculate/exportPdf/getUsage/saveLicenseKey/getLicenseStatus/clearLicenseKey/getProfile/saveProfile/createSample）。
- 6分制限: 1書類単位の処理のためバッチ分割は不要（N-2は応答性目標のみ）。

## 7. バックエンド実装の要点（柱3 `b516718` からのコピー移植）

- 移植対象: `backend/src/services/{license.ts, stripeGateway.ts}`・`routes/{license.ts, stripeWebhook.ts}`・`app.ts`/`config.ts`/`index.ts`の骨格・対応テスト（license/licenseRoutes/app系）・`Dockerfile`・`.env.example`・backend/README（**Ed25519鍵のopenssl導出手順とStripe Dashboard設定手順を含む**）。
- 変更点: ①`LICENSE_ISSUER='quote-invoice-maker'`／`LICENSE_AUDIENCE='quote-invoice-maker-license'` ②法人番号・gBizINFO・インボイス・Firestore・quota・ApiHealthTracker系を**構成ごと削除**（envは`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`LICENSE_SIGNING_KEY`/`PORT`のみ） ③`/health`は`{ok:true}`最小 ④config.tsの「値をログ・エラーに出さない（変数名のみ）」方針は維持。
- **維持する設計（実装・検証済み。変えない）**: Ed25519(EdDSA) JWT（jose、sub=Stripe顧客ID、exp=2年、**キーをDBに保存しない**）／`/license/claim`=session_id→`payment_status==='paid'`→冪等発行（thanksページが使用）／`/license/recover`=**有効購読を持つ顧客のみ**・一律404文言・**IPクールダウン60秒**（x-forwarded-for先頭）／`/license/verify`=署名＋購読照合、`active|trialing`または`cancel_at_period_end=true`かつ期間末が未来ならvalid（特商法「解約後も期間満了までPro」と一致）・**5分メモリキャッシュ**／**Stripe API v2324は`current_period_end`が購読itemsに移動**→itemsの最大値を採用／StripeGatewayはDI＋テストフェイク（実Stripe・実ネットワークをテストで叩かない）／webhookは生ボディ（Honoの`c.req.text()`）で`constructEvent`署名検証・`checkout.session.completed`のみ・**検証のみで保存なし・冪等**・署名不正400・secret未設定503。
- ビルド: workspace TSソース依存が無いため通常のtsc/esbuildビルドで`node dist/index.js`が起動できるはず。ただし**柱3で「dist起動不可（ERR_UNKNOWN_FILE_EXTENSION）」の既知事故**があるため、デプロイ前に必ずローカルで`node dist/index.js`スモークを実施しdecisions.mdに記録する。
- Cloud Run: region=`asia-northeast1`、`max-instances=1`（コスト上限ガード。直列要件はない）、`min-instances=0`。コールドスタートはサイドバー「接続中…」表示で吸収（無言のフリーズにしない）。デプロイ操作・Secret投入は人間タスク。

## 8. 検証済みファクト / 未検証事項

- **税務・電帳法の確定値と出典は要件書§6が正**（本書に重複させない）。実装上の追加確定: 割戻し計算固定／ファイル名の金額は税込で統一／源泉税の切捨ては合算後1回。
- 柱3実装ファクト（clone確認済み）: §7の設計一式／柱3のライセンス検証は製品非対応（§2の別鍵分離の根拠）／web `thanks.html`・`license-recover.html`は`const BACKEND_URL=''`プレースホルダ＋未設定時「準備中」表示の型。
- 審査ファクト（柱3実績）: §5の審査フロー／standaloneスクリプト＋版指定デプロイ／¥1,480はStripe側**税込単価**として設定し、特商法表記・リスティングと**同一文言**（三者不一致は差し戻しの典型）／Checkout成功URLは`.../thanks.html?session_id={CHECKOUT_SESSION_ID}`。
- GASファクト: UserPropertiesはユーザー×スクリプト単位で追加スコープ不要／プロパティ消去=無料枠リセットは許容（柱3 R3-1と同水準の割り切り・対策コードを書かない）／urlFetchWhitelistは公開アドオンで強制されるため必要URLを漏らさない。
- **未検証（断定禁止）**: V-1（export URLの4スコープ認可・A4レイアウト品質）／V-2（Advanced Drive Serviceのdrive.file下での実挙動）。**スパイク→実機実行（人間）→decisions.md記録**の順で確定してから本実装に接続する。確度の低い前提で実装を積まない（柱3で「実IDが英数字混在でバリデーション全拒否になるはずだった」事故をライブ検証で公開前検出した教訓）。

## 9. シークレット・環境変数

- GAS Script Properties: `BACKEND_URL` のみ。
- Backend（Cloud Run env / Secret Manager）: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `LICENSE_SIGNING_KEY`（PKCS8 PEM・**柱3とは別の新規ペア**）, `PORT`。
- web: thanks/license-recoverの`BACKEND_URL`プレースホルダはデプロイ後に人間が差替。
- **コード・リポジトリ・ログにキー・シークレットを含めない。** ローカルは`.env`（gitignore済みを初回に確認）。

## 10. テスト・監視

- vitest。重心: `calc.ts`のgolden（要件書§6-6のG-1〜G-11をfixtureに固定。**自動上書き禁止**・変更は人間のdiffレビュー）＋`naming.ts`（整形・衝突連番）＋`quota.ts`（月替り・ロック）＋backend移植分（柱3テストを流用）。
- CRテスト（決定的コードガードを優先）: ①`scopes.test.ts`＋`check-oauth-scopes.mjs`を4点版に（ビルド前後2回） ②**CR-1走査**: ソース全体に`invoice-kohyo`等の照会エンドポイント・照会クライアント・「検証」機能が存在しないことをスキャン ③価格・無料枠定数（1480／3／1000）がdocs記載と一致するテスト。
- 監視: backendは`/health`＋Cloud Runの5xxアラート（GCPコンソール設定は人間タスク・backend/READMEに記載）。柱3のApiHealthTracker等は移植しない（公的APIが無い）。

## 11. フェーズ計画とDefinition of Done

| Phase | 内容 | DoD |
|---|---|---|
| P0 | リポジトリ雛形（workspace/CI/clasp/esbuild・4スコープ版）＋**V-1/V-2スパイクコード** | CI緑。スパイクの実行手順を人間へ提示（テストシートで10分） |
| P1 | `calc.ts`＋golden→入力/帳票/台帳シート→PDF→命名保存（V-1/V-2確定後に接続） | golden全緑。サンプル書類で見積→請求→PDF→Drive保存がE2Eで通る |
| P2 | 無料枠＋ライセンス（GAS側）＋backend移植＋web雛形 | 課金E2E（Stripeテストモード）緑。`node dist/index.js`スモーク緑 |
| P3 | 審査提出物（スコープ理由書ドラフト・デモ動画台本・スクショ用サンプルデータ）＋README | 要件書§9の1・2・7充足。残タスクが人間作業のみ＝週末Done |

タイムライン: P0〜P3＝7/11〜12。**既存4本の作業と競合したらそちらを優先。**

## 12. 実装初日のタスク

0. （人間・並行）柱3ドメインの取得状況確認→サブドメイン方針の仮決め（§5）。
1. リポジトリ雛形: 柱3のroot package.json／ci.yml／apps-script構成を移植し4スコープ版へ更新。`pnpm typecheck && pnpm test`緑。
2. `calc.ts`＋golden G-1〜G-11を先に緑にする（最重要ロジックを最初に固定）。
3. **V-1/V-2スパイク**: `exportPdfProbe()`／`driveProbe()`を用意し、人間がテストシートで実行→結果（HTTPステータス・生成物の確認）を`docs/decisions.md`へ。不成立時は§6のフォールバック順、(2)到達で**停止して報告**。
4. シート生成〜帳票〜PDF〜保存の本実装（V確定後に接続）。
5. backend移植（§7の変更点）→`node dist/index.js`スモーク→decisions.mdに1行。
6. web/雛形（柱3 webの型・プレースホルダ運用）＋docs/setup/の手順書（gcp-oauth・domain-pages・claspの本製品版）。

## 13. Do / Don't（絶対規則）

**Do**: CR-1〜5を実装とテストの両方で担保／golden方式（自動上書き禁止）／すべての計算値に根拠注記（N-1）／失敗の可視化（無言で失敗しない）／未検証事実は実機で確定してから実装する。

**Don't**:
- **インボイス登録番号の照会・検証コードを書かない**（CR-1）。エンドポイントURL・クライアント・「登録確認」ボタンを存在させない。形式チェック`/^T\d{13}$/`のみ可。機能要望が来ても断り、柱3への導線で受ける。
- **スコープを4点から増やさない**（CR-3）。V-1/V-2が不成立でもスコープ追加で解決しない——停止して人間判断（要件書改訂を要する事業判断）。
- 経理部門向け機能（承認ワークフロー・複数人運用・仕訳連携）を作らない（CR-2）。
- シート内容（明細・取引先名）を外部送信しない・ログに出さない（N-3）。
- 柱3リポジトリを変更しない。柱2パッケージを取り込まない。
- golden・単価（¥1,480税込）・無料枠（月3枚）・Pro上限（月1,000枚）・プラン文言を独断で変更しない。
- メール送信基盤を導入しない（キー配布はthanksページ表示型＝柱3 R3-2の確定思想）。
- LLM・外部SaaS依存を追加しない（本製品は決定的計算のみで完結する）。
- シークレットをコード・リポジトリ・ログに置かない（CR-5）。
- Marketplace公開操作・Stripe/GCP/ドメイン設定は人間タスク。完了報告に「残り（人間タスク）」節を必ず付ける。

## 14. 要件↔実装対応の要点

FR-1/2→sheets.ts＋layout.ts／FR-3/4→calc.ts（golden）／FR-5/6→template.ts＋_帳票／FR-7→pdf.ts（V-1）／FR-8→drive.ts＋naming.ts（V-2）／FR-9→quota.ts／FR-10→license.ts＋backend／FR-11→profile.ts／FR-12→ledger.ts／FR-13→sample.ts／FR-14→sidebar.htmlヘルプ節（marketing §9のverbatim含む）／CR-1→CR走査テスト／CR-3→appsscript.json＋CIスコープチェック／N-1→calc.notes＋帳票注記。

---
*本書はv1.0。更新トリガー: V-1/V-2の確定／未決事項の解消／decisions.mdの昇格／審査結果。*
