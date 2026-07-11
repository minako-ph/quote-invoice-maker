/**
 * 出力台帳（FR-12）。PDF保存成功時に台帳シートへ1行追記する。
 *
 * 日付・金額・取引先を持つため電帳法の索引簿的にも活用できるが、
 * **法的要件の充足を保証する表現はしない**（CR-4。UI文言にも書かない）。
 */

import { DOC_TYPE_LABELS, LEDGER_HEADERS, LEDGER_SHEET_NAME, type DocumentType } from './layout';

/** 台帳シートを確保する（無ければヘッダ付きで作成）。 */
function ensureLedgerSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(LEDGER_SHEET_NAME);
  if (existing !== null) return existing;
  const sheet = ss.insertSheet(LEDGER_SHEET_NAME);
  sheet
    .getRange(1, 1, 1, LEDGER_HEADERS.length)
    .setValues([[...LEDGER_HEADERS]])
    .setFontWeight('bold')
    .setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  return sheet;
}

/** 台帳へ1行追記する（FR-12の列: 発行日・書類種別・書類番号・取引先・税込金額・ファイルリンク）。 */
export function appendLedgerRow(entry: {
  readonly issueDate: Date;
  readonly type: DocumentType;
  readonly docNumber: string;
  readonly clientName: string;
  readonly totalInclTax: number;
  readonly fileUrl: string;
}): void {
  const sheet = ensureLedgerSheet();
  sheet.appendRow([
    Utilities.formatDate(entry.issueDate, 'Asia/Tokyo', 'yyyy/MM/dd'),
    DOC_TYPE_LABELS[entry.type],
    entry.docNumber,
    entry.clientName,
    entry.totalInclTax,
    entry.fileUrl,
  ]);
}
