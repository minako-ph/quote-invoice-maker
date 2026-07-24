/**
 * 入力シートの生成・読み取り・集計書き込み（FR-1/FR-2。引継書§6）。
 *
 * 入力シートは1書類=1シート・固定レイアウト（セル座標は layout.ts に集約）。
 * 計算はシート数式で行わない（計算源は calc.ts のみ）。
 */

import type { CalcResult, LineItemInput, TaxCategory } from './calc';
import {
  DOC_TYPE_LABELS,
  INPUT_HEADER,
  INPUT_LABEL_COL,
  INPUT_SHEET_COLS,
  INPUT_SHEET_ROWS,
  INPUT_VALUE_COL,
  ITEMS,
  NOTES,
  REMARKS,
  SUMMARY,
  taxCategoryOfCellValue,
  TAX_CATEGORY_LABELS,
  TAX_CATEGORY_OPTIONS,
  docTypeOfLabel,
  dueOrExpiryLabelOf,
  inputSheetNameOf,
  type DocumentType,
} from './layout';
import { loadProfile, type IssuerProfile } from './profile';

/** 入力シートから読み取った書類データ。 */
export interface DocumentData {
  readonly type: DocumentType;
  readonly docNumber: string;
  readonly issueDate: Date;
  /** 取引年月日または期間（自由書式の文字列）。 */
  readonly transactionDate: string;
  readonly clientName: string;
  readonly subject: string;
  /** 支払期限（請求書）/有効期限（見積書）の表示文字列。 */
  readonly dueOrExpiry: string;
  readonly bankInfo: string;
  readonly withholdingEnabled: boolean;
  readonly items: readonly LineItemInput[];
  readonly remarks: string;
}

const SEQ_PROP_KEY = 'docSeq';

/** 書類番号の連番を採番する（DocumentProperties。手動上書き可＝FR-1）。 */
function nextSequence(type: DocumentType): number {
  const props = PropertiesService.getDocumentProperties();
  const json = props.getProperty(SEQ_PROP_KEY);
  let quote = 0;
  let invoice = 0;
  if (json !== null) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null) {
        const q = Reflect.get(parsed, 'quote');
        const i = Reflect.get(parsed, 'invoice');
        if (typeof q === 'number' && Number.isInteger(q) && q >= 0) quote = q;
        if (typeof i === 'number' && Number.isInteger(i) && i >= 0) invoice = i;
      }
    } catch {
      // 壊れていたら0から振り直す
    }
  }
  if (type === 'quote') quote += 1;
  else invoice += 1;
  props.setProperty(SEQ_PROP_KEY, JSON.stringify({ quote, invoice }));
  return type === 'quote' ? quote : invoice;
}

/** 書類番号を組み立てる（プレフィックス＋種別記号＋4桁連番）。 */
export function buildDocNumber(type: DocumentType, prefix: string, seq: number): string {
  const typeMark = type === 'quote' ? 'Q' : 'I';
  return `${prefix}${typeMark}-${String(seq).padStart(4, '0')}`;
}

/** 新規作成時の初期値（見積→請求変換の引継ぎに使用）。 */
export interface DocumentSeed {
  readonly clientName?: string;
  readonly subject?: string;
  readonly transactionDate?: string;
  readonly items?: readonly LineItemInput[];
  readonly remarks?: string;
}

/**
 * 入力シートを新規生成してアクティブにする（FR-1）。
 * @returns 生成したシート名
 */
export function createInputSheet(type: DocumentType, seed: DocumentSeed = {}): string {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const profile = loadProfile();
  const docNumber = buildDocNumber(type, profile.docNumberPrefix, nextSequence(type));

  let name = inputSheetNameOf(type, docNumber);
  if (ss.getSheetByName(name) !== null) {
    name = `${name}_${Date.now()}`;
  }
  const sheet = ss.insertSheet(name);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidths(2, INPUT_SHEET_COLS - 1, 130);

  // ヘッダブロック
  const today = new Date();
  setHeader(sheet, INPUT_HEADER.docType.row, INPUT_HEADER.docType.label, DOC_TYPE_LABELS[type]);
  setHeader(sheet, INPUT_HEADER.docNumber.row, INPUT_HEADER.docNumber.label, docNumber);
  setHeader(sheet, INPUT_HEADER.issueDate.row, INPUT_HEADER.issueDate.label, today);
  sheet.getRange(INPUT_HEADER.issueDate.row, INPUT_VALUE_COL).setNumberFormat('yyyy/mm/dd');
  setHeader(
    sheet,
    INPUT_HEADER.transactionDate.row,
    INPUT_HEADER.transactionDate.label,
    seed.transactionDate ?? '',
  );
  setHeader(sheet, INPUT_HEADER.clientName.row, INPUT_HEADER.clientName.label, seed.clientName ?? '');
  setHeader(sheet, INPUT_HEADER.subject.row, INPUT_HEADER.subject.label, seed.subject ?? '');
  setHeader(sheet, INPUT_HEADER.dueOrExpiry.row, dueOrExpiryLabelOf(type), '');
  setHeader(
    sheet,
    INPUT_HEADER.bankInfo.row,
    INPUT_HEADER.bankInfo.label,
    type === 'invoice' ? profile.bankInfo : '',
  );
  setHeader(
    sheet,
    INPUT_HEADER.withholdingEnabled.row,
    INPUT_HEADER.withholdingEnabled.label,
    '',
  );
  sheet
    .getRange(INPUT_HEADER.withholdingEnabled.row, INPUT_VALUE_COL)
    .insertCheckboxes()
    .setValue(profile.withholdingDefault);

  // 明細ブロック
  const headerRange = sheet.getRange(ITEMS.headerRow, 1, 1, ITEMS.headers.length);
  headerRange.setValues([[...ITEMS.headers]]).setFontWeight('bold').setBackground('#f0f0f0');
  const taxRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([...TAX_CATEGORY_OPTIONS], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(ITEMS.startRow, ITEMS.col.taxCategory, ITEMS.rowCount, 1).setDataValidation(taxRule);
  sheet.getRange(ITEMS.startRow, ITEMS.col.withholding, ITEMS.rowCount, 1).insertCheckboxes();
  sheet.getRange(ITEMS.startRow, ITEMS.col.quantity, ITEMS.rowCount, 2).setNumberFormat('#,##0.###');

  if (seed.items !== undefined && seed.items.length > 0) {
    const rows = seed.items.slice(0, ITEMS.rowCount).map((item) => [
      item.name,
      item.quantity,
      item.unitPrice,
      TAX_CATEGORY_LABELS[item.taxCategory],
      item.withholding,
    ]);
    sheet.getRange(ITEMS.startRow, 1, rows.length, ITEMS.headers.length).setValues(rows);
  }

  // 集計ブロックのラベル（値は再計算/PDF出力時に GAS が書く）
  const summaryKeys = Object.keys(SUMMARY.rows);
  for (const key of summaryKeys) {
    const row = Reflect.get(SUMMARY.rows, key);
    const label = Reflect.get(SUMMARY.labels, key);
    if (typeof row === 'number' && typeof label === 'string') {
      sheet.getRange(row, SUMMARY.labelCol).setValue(label);
      sheet.getRange(row, SUMMARY.valueCol).setNumberFormat('#,##0');
    }
  }
  sheet.getRange(NOTES.headerRow, 1).setValue(NOTES.headerLabel).setFontWeight('bold');
  sheet.getRange(REMARKS.labelRow, 1).setValue(REMARKS.label).setFontWeight('bold');
  if (seed.remarks !== undefined && seed.remarks !== '') {
    sheet.getRange(REMARKS.valueRow, 1).setValue(seed.remarks);
  }

  // 余分な行・列を整理（見通しのため。失敗しても致命的でない）
  try {
    const maxRows = sheet.getMaxRows();
    if (maxRows > INPUT_SHEET_ROWS) sheet.deleteRows(INPUT_SHEET_ROWS + 1, maxRows - INPUT_SHEET_ROWS);
  } catch {
    // 行削除は装飾目的のため失敗を無視する
  }

  sheet.activate();
  return name;
}

function setHeader(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  row: number,
  label: string,
  value: string | number | Date,
): void {
  sheet.getRange(row, INPUT_LABEL_COL).setValue(label).setFontWeight('bold');
  sheet.getRange(row, INPUT_VALUE_COL).setValue(value);
}

/** アクティブシートが入力シートか検証して返す（違えばエラー）。 */
export function activeInputSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const label = String(sheet.getRange(INPUT_HEADER.docType.row, INPUT_VALUE_COL).getValue());
  if (docTypeOfLabel(label) === undefined) {
    throw new Error(
      '入力シートを開いた状態で実行してください（サイドバーの「新規作成」で作成したシートが対象です）',
    );
  }
  return sheet;
}

/** セル値を文字列化（日付は yyyy/MM/dd）。 */
function cellText(value: unknown): string {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy/MM/dd');
  }
  return String(value ?? '').trim();
}

/** 入力シートから書類データを読み取る（FR-1〜4の入力面）。 */
export function readDocument(sheet: GoogleAppsScript.Spreadsheet.Sheet): DocumentData {
  const headerValue = (row: number): unknown => sheet.getRange(row, INPUT_VALUE_COL).getValue();

  const typeLabel = String(headerValue(INPUT_HEADER.docType.row));
  const type = docTypeOfLabel(typeLabel);
  if (type === undefined) {
    throw new Error('書類種別（B1）が見積書/請求書のいずれでもありません');
  }

  const issueRaw = headerValue(INPUT_HEADER.issueDate.row);
  const issueDate = issueRaw instanceof Date ? issueRaw : new Date();

  const itemsRange = sheet
    .getRange(ITEMS.startRow, 1, ITEMS.rowCount, ITEMS.headers.length)
    .getValues();
  const items: LineItemInput[] = [];
  for (let i = 0; i < itemsRange.length; i++) {
    const row = itemsRange[i] ?? [];
    const name = String(row[ITEMS.col.name - 1] ?? '').trim();
    const quantityRaw = row[ITEMS.col.quantity - 1];
    const unitPriceRaw = row[ITEMS.col.unitPrice - 1];
    const quantity = typeof quantityRaw === 'number' ? quantityRaw : Number(quantityRaw) || 0;
    const unitPrice = typeof unitPriceRaw === 'number' ? unitPriceRaw : Number(unitPriceRaw) || 0;
    if (name === '' && quantity === 0 && unitPrice === 0) continue;
    // 生値のまま解釈する（旧ラベル'10%'がSheetsで数値0.1に自動変換されたセルも救済。layout.ts）
    const category: TaxCategory | undefined = taxCategoryOfCellValue(row[ITEMS.col.taxCategory - 1]);
    if (category === undefined) {
      // F-7: 空欄・プルダウン外の値を黙って10%にしない（根拠のない既定を作らない）
      throw new Error(
        `明細${i + 1}行目の税率を選択してください（${TAX_CATEGORY_OPTIONS.join(' / ')}）`,
      );
    }
    items.push({
      name,
      quantity,
      unitPrice,
      taxCategory: category,
      withholding: row[ITEMS.col.withholding - 1] === true,
    });
  }

  return {
    type,
    docNumber: cellText(headerValue(INPUT_HEADER.docNumber.row)),
    issueDate,
    transactionDate: cellText(headerValue(INPUT_HEADER.transactionDate.row)),
    clientName: cellText(headerValue(INPUT_HEADER.clientName.row)),
    subject: cellText(headerValue(INPUT_HEADER.subject.row)),
    dueOrExpiry: cellText(headerValue(INPUT_HEADER.dueOrExpiry.row)),
    bankInfo: cellText(headerValue(INPUT_HEADER.bankInfo.row)),
    withholdingEnabled: headerValue(INPUT_HEADER.withholdingEnabled.row) === true,
    items,
    remarks: cellText(sheet.getRange(REMARKS.valueRow, 1).getValue()),
  };
}

/** 集計ブロックと根拠注記を入力シートへ書き込む（N-1）。 */
export function writeSummary(sheet: GoogleAppsScript.Spreadsheet.Sheet, result: CalcResult): void {
  const set = (row: number, value: number): void => {
    sheet.getRange(row, SUMMARY.valueCol).setValue(value);
  };
  set(SUMMARY.rows.subtotal10, result.subtotal10);
  set(SUMMARY.rows.tax10, result.tax10);
  set(SUMMARY.rows.subtotal8, result.subtotal8);
  set(SUMMARY.rows.tax8, result.tax8);
  set(SUMMARY.rows.subtotalExempt, result.subtotalExempt);
  set(SUMMARY.rows.subtotal, result.subtotal);
  set(SUMMARY.rows.taxTotal, result.taxTotal);
  set(SUMMARY.rows.total, result.total);
  set(SUMMARY.rows.withholdingTax, result.withholdingTax);
  set(SUMMARY.rows.amountDue, result.amountDue);

  const notesRange = sheet.getRange(NOTES.startRow, 1, NOTES.maxRows, 1);
  notesRange.clearContent();
  const notes = result.notes.slice(0, NOTES.maxRows).map((n) => [n]);
  if (notes.length > 0) {
    sheet.getRange(NOTES.startRow, 1, notes.length, 1).setValues(notes);
  }
}

/**
 * 見積→請求のワンクリック変換（FR-2）。
 * 明細・取引先・件名・取引年月日を引継ぎ、書類番号・発行日を更新、
 * 支払期限・源泉税欄（既定=プロファイル設定値）・振込先を有効化する。
 */
export function convertQuoteToInvoice(): string {
  const sheet = activeInputSheet();
  const doc = readDocument(sheet);
  if (doc.type !== 'quote') {
    throw new Error('見積書の入力シートを開いた状態で実行してください（請求書への変換元は見積書のみです）');
  }
  const profile: IssuerProfile = loadProfile();
  const name = createInputSheet('invoice', {
    clientName: doc.clientName,
    subject: doc.subject,
    transactionDate: doc.transactionDate,
    items: doc.items,
    remarks: doc.remarks,
  });
  // 変換元の源泉設定は見積側の状態を引き継ぐ（見積で明示していた場合を優先）
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const invoiceSheet = ss.getSheetByName(name);
  if (invoiceSheet !== null && doc.withholdingEnabled !== profile.withholdingDefault) {
    invoiceSheet
      .getRange(INPUT_HEADER.withholdingEnabled.row, INPUT_VALUE_COL)
      .setValue(doc.withholdingEnabled);
  }
  return name;
}
