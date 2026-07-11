/**
 * 帳票シート「_帳票」への差し込み（FR-5/FR-6。引継書§6）。
 *
 * 非表示の帳票シート1枚を使い回し、PDF出力の都度、入力シートの内容＋計算結果＋
 * 発行者プロファイルを差し込む。
 * - 課税（適格）: 要件書§6-3の記載事項6項目を満たす（登録番号・適用税率・税率ごとの消費税額等）。
 * - 免税: 要件書§6-4の区分記載請求書（登録番号なし・税率ごとの**税込**対価の額）。
 * - すべての計算値に根拠注記を出す（N-1）。
 *
 * A4縦のレイアウト品質は V-1 スパイクの実機確認後に微調整する（TODO: V-1確定後）。
 */

import type { CalcResult } from './calc';
import { TAX_CATEGORY_LABELS, TEMPLATE_SHEET_NAME, type DocumentType } from './layout';
import type { IssuerProfile } from './profile';
import type { DocumentData } from './sheets';

/** 帳票の列数（A〜F）。 */
const COLS = 6;

/** PDF出力対象の範囲情報。 */
export interface TemplateRenderResult {
  readonly sheetId: number;
  /** 出力範囲（A1形式。例 'A1:F58'）。 */
  readonly range: string;
}

/** 円表記。 */
function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

/** 日付表記。 */
function dateText(date: Date): string {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年MM月dd日');
}

/**
 * 帳票シートを描画して出力範囲を返す。
 */
export function renderTemplate(
  doc: DocumentData,
  result: CalcResult,
  profile: IssuerProfile,
): TemplateRenderResult {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TEMPLATE_SHEET_NAME);
  if (sheet === null) {
    sheet = ss.insertSheet(TEMPLATE_SHEET_NAME);
  }
  sheet.hideSheet();
  sheet.clear();
  sheet.clearFormats();

  // 列幅（A4縦・約700px幅を6列に配分。V-1確定後に微調整）
  const widths = [180, 90, 70, 90, 90, 110];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  const title = doc.type === 'invoice' ? '請求書' : '見積書';
  const rows: (string | number)[][] = [];
  const pushRow = (cells: (string | number)[]): number => {
    const padded = [...cells];
    while (padded.length < COLS) padded.push('');
    rows.push(padded);
    return rows.length; // 1始まりの行番号
  };

  // ---- ヘッダ部 ----
  const titleRow = pushRow([title]);
  pushRow(['']);
  const clientRow = pushRow([`${doc.clientName} 御中`, '', '', '書類番号', '', doc.docNumber]);
  pushRow(['', '', '', '発行日', '', dateText(doc.issueDate)]);
  if (profile.taxable && profile.registrationNumber !== '') {
    pushRow(['', '', '', '登録番号', '', profile.registrationNumber]);
  }
  pushRow(['']);
  pushRow([`件名: ${doc.subject}`, '', '', profile.name]);
  pushRow([`取引年月日/期間: ${doc.transactionDate}`, '', '', profile.address]);
  const dueLabel = doc.type === 'invoice' ? 'お支払期限' : '有効期限';
  pushRow([doc.dueOrExpiry !== '' ? `${dueLabel}: ${doc.dueOrExpiry}` : '']);
  pushRow(['']);

  // ---- 金額サマリ（請求書=差引請求額・見積書=税込合計）----
  const headline = doc.type === 'invoice' ? 'ご請求金額' : 'お見積金額';
  const headlineAmount = doc.type === 'invoice' ? result.amountDue : result.total;
  const headlineRow = pushRow([headline, yen(headlineAmount)]);
  pushRow(['']);

  // ---- 明細表 ----
  const tableHeaderRow = pushRow(['品目', '数量', '単価（税抜）', '税率', '', '金額（税抜）']);
  const has8 = result.lines.some((l) => l.taxCategory === '8');
  let firstItemRow = 0;
  let lastItemRow = 0;
  for (const line of result.lines) {
    const mark = line.taxCategory === '8' ? '※' : '';
    const row = pushRow([
      `${line.name}${mark}`,
      line.quantity,
      line.unitPrice,
      TAX_CATEGORY_LABELS[line.taxCategory],
      '',
      line.amount,
    ]);
    if (firstItemRow === 0) firstItemRow = row;
    lastItemRow = row;
  }
  pushRow(['']);

  // ---- 集計 ----
  const summaryStart = rows.length + 1;
  if (profile.taxable) {
    // 適格請求書: 税率ごとに区分した税抜対価の額・適用税率・消費税額等（§6-3 ④⑤）
    if (result.subtotal10 > 0 || result.tax10 > 0) {
      pushRow(['', '', '', '10%対象（税抜）', '', yen(result.subtotal10)]);
      pushRow(['', '', '', '消費税（10%）', '', yen(result.tax10)]);
    }
    if (result.subtotal8 > 0 || result.tax8 > 0) {
      pushRow(['', '', '', '8%対象（税抜）※軽減税率', '', yen(result.subtotal8)]);
      pushRow(['', '', '', '消費税（8%）', '', yen(result.tax8)]);
    }
    if (result.subtotalExempt > 0) {
      pushRow(['', '', '', '対象外', '', yen(result.subtotalExempt)]);
    }
    pushRow(['', '', '', '小計（税抜）', '', yen(result.subtotal)]);
    pushRow(['', '', '', '消費税合計', '', yen(result.taxTotal)]);
    pushRow(['', '', '', '合計（税込）', '', yen(result.total)]);
  } else {
    // 区分記載請求書（免税事業者モード）: 税率ごとに区分した税込対価の額（§6-4 ④）
    if (result.subtotal10 > 0 || result.tax10 > 0) {
      pushRow(['', '', '', '10%対象（税込）', '', yen(result.subtotal10 + result.tax10)]);
    }
    if (result.subtotal8 > 0 || result.tax8 > 0) {
      pushRow(['', '', '', '8%対象（税込）※軽減税率', '', yen(result.subtotal8 + result.tax8)]);
    }
    if (result.subtotalExempt > 0) {
      pushRow(['', '', '', '対象外', '', yen(result.subtotalExempt)]);
    }
    pushRow(['', '', '', '合計（税込）', '', yen(result.total)]);
  }
  if (doc.withholdingEnabled && result.withholdingTax > 0) {
    pushRow(['', '', '', '源泉徴収税額', '', `-${yen(result.withholdingTax)}`]);
    pushRow(['', '', '', '差引請求額', '', yen(result.amountDue)]);
  }
  const summaryEnd = rows.length;
  pushRow(['']);

  // ---- 振込先（請求書のみ）----
  if (doc.type === 'invoice' && doc.bankInfo !== '') {
    pushRow(['お振込先']);
    pushRow([doc.bankInfo]);
    pushRow(['']);
  }

  // ---- 注記（N-1）----
  const notes: string[] = [];
  if (has8) notes.push('※は軽減税率対象品目');
  notes.push(...result.notes);
  if (doc.remarks !== '') notes.push(`備考: ${doc.remarks}`);
  let notesStart = 0;
  if (notes.length > 0) {
    notesStart = pushRow(['注記']);
    for (const note of notes) pushRow([note]);
  }

  // ---- 書き込み ----
  const lastRow = rows.length;
  sheet.getRange(1, 1, lastRow, COLS).setValues(rows).setFontSize(10).setVerticalAlignment('middle');

  // 書式
  sheet
    .getRange(titleRow, 1, 1, COLS)
    .merge()
    .setFontSize(18)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRange(clientRow, 1).setFontSize(12).setFontWeight('bold');
  sheet
    .getRange(headlineRow, 1, 1, 2)
    .setFontSize(14)
    .setFontWeight('bold')
    .setBorder(null, null, true, null, null, null);
  sheet
    .getRange(tableHeaderRow, 1, 1, COLS)
    .setFontWeight('bold')
    .setBackground('#efefef')
    .setBorder(true, true, true, true, true, true);
  if (firstItemRow > 0) {
    sheet
      .getRange(firstItemRow, 1, lastItemRow - firstItemRow + 1, COLS)
      .setBorder(true, true, true, true, true, true);
    sheet
      .getRange(firstItemRow, 2, lastItemRow - firstItemRow + 1, 2)
      .setNumberFormat('#,##0.###');
    sheet
      .getRange(firstItemRow, COLS, lastItemRow - firstItemRow + 1, 1)
      .setNumberFormat('#,##0');
  }
  sheet.getRange(summaryStart, 4, summaryEnd - summaryStart + 1, 3).setBorder(true, true, true, true, false, true);
  if (notesStart > 0) {
    sheet.getRange(notesStart, 1).setFontWeight('bold');
    sheet.getRange(notesStart, 1, lastRow - notesStart + 1, 1).setFontSize(8).setFontColor('#555555');
  }

  return { sheetId: sheet.getSheetId(), range: `A1:F${lastRow}` };
}
