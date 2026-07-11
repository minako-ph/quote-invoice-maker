/**
 * 電帳法対応のファイル命名（FR-8・要件書§6-5。純関数・テスト対象）。
 *
 * 既定命名: `YYYYMMDD_取引先名_税込金額.pdf`（日付=発行日・金額=税込整数で統一）。
 * 国税庁一問一答の例示（「20221031_㈱国税商事_110000」）に準拠し、
 * 取引先名は前後空白・改行/制御文字の除去と `/` 等ファイル名禁止文字の置換**のみ**行う
 * （㈱等の記号はそのまま＝例示準拠。引継書§6）。
 * 同名衝突は末尾 `_2` からの連番を付す。
 */

/** ファイル名に使えない文字（Drive はほぼ何でも許すが、OS間の互換のため置換する）。 */
const FORBIDDEN_CHARS = /[/\\:*?"<>|]/g;

/** 制御文字・改行（除去対象）。タブ・改行・C0/C1制御文字。 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * 取引先名をファイル名要素向けに整形する。
 * 機械的整形のみ（要件書FR-8: 日付・取引先・金額の3要素と順序は固定）。
 */
export function sanitizeClientName(raw: string): string {
  const cleaned = raw.replace(CONTROL_CHARS, '').trim().replace(FORBIDDEN_CHARS, '_');
  return cleaned === '' ? '取引先未設定' : cleaned;
}

/** Date → YYYYMMDD（スクリプトタイムゾーン=Asia/Tokyo 前提。appsscript.json で固定済み）。 */
export function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 既定のPDFファイル名を組み立てる（拡張子つき）。
 * @param issueDate 発行日
 * @param clientName 取引先名（未整形でよい）
 * @param totalInclTax 税込金額（円・整数）
 */
export function buildPdfFileName(issueDate: Date, clientName: string, totalInclTax: number): string {
  const ymd = formatDateYmd(issueDate);
  const client = sanitizeClientName(clientName);
  const amount = Math.floor(totalInclTax);
  return `${ymd}_${client}_${amount}.pdf`;
}

/**
 * 同名衝突を末尾連番（`_2` から）で回避する。
 * @param fileName 希望ファイル名（`.pdf` つき）
 * @param exists 同名の存在判定（保存先フォルダ内の検索を注入。テスト容易性のため関数で受ける）
 */
export function resolveNameCollision(fileName: string, exists: (name: string) => boolean): string {
  if (!exists(fileName)) return fileName;
  const stem = fileName.endsWith('.pdf') ? fileName.slice(0, -4) : fileName;
  for (let n = 2; ; n++) {
    const candidate = `${stem}_${n}.pdf`;
    if (!exists(candidate)) return candidate;
  }
}
