# quote-invoice-maker

作業前に必ず docs/handover.md を全文読むこと。§13 Do/Don't と CR-1〜5 は絶対規則。
読み順: docs/handover.md → docs/requirements.md → docs/marketing.md（矛盾時は requirements.md が正）
OAuthスコープは4点固定（handover §5）。増やすPRは作らない。V-1/V-2が不成立でもスコープ追加で解決せず、停止して人間判断を仰ぐ。
インボイス登録番号の照会・検証コードを書かない（CR-1。形式チェック `/^T\d{13}$/` のみ可）。経理部門向け機能を作らない（CR-2）。
未定義事項は最小実装＋TODOで前進し、docs/decisions.md に1行残す。
検証: pnpm typecheck && pnpm test（着手前に緑を確認。golden は自動上書き禁止）
既存4本（柱1 jp-tender-intel・柱2 jp-opendata-actors・柱3 company-list-cleaner・入札ウォッチ）の出荷作業と競合したら常にそちらを優先する。
backend/ 等は company-list-cleaner `b516718` からのコピー移植（本リポジトリで改変自由・出所は docs/decisions.md に記録）。柱2のsubtree規律の対象外であり、柱3リポジトリ側には一切手を入れない。
単価（¥1,480税込）・無料枠（月3枚）・Pro上限（月1,000枚）・docs内の確定文言を独断で変更しない。シークレットをリポジトリ・ログに置かない。
