/**
 * 帳票の差し込みリクエスト生成（FR-5/FR-6。V-1確定構成＝decisions.md 2026-07-24）。
 *
 * V-1実測により、帳票はコンテナ内シートではなく**アプリ作成の作業スプレッドシート
 * （scratch.ts）に Sheets Advanced Service（v4 batchUpdate）で描画**する。
 * 本モジュールはその batchUpdate リクエスト列を組み立てる**純関数のみ**で構成する
 * （SpreadsheetApp・Utilities 等のGASグローバルに依存しない＝vitestで検証可能）。
 *
 * - 課税（適格）: 要件書§6-3の記載事項6項目を満たす（登録番号・適用税率・税率ごとの消費税額等）。
 * - 免税: 要件書§6-4の区分記載請求書（登録番号なし・税率ごとの**税込**対価の額）。
 * - すべての計算値に根拠注記を出す（N-1）。
 * - A4縦のレイアウト品質は受入E2Eの目視で微調整する。
 */

import type { CalcResult } from './calc';
import { TAX_CATEGORY_LABELS } from './layout';
import type { IssuerProfile } from './profile';
import type { DocumentData } from './sheets';

/** 帳票の列数（A〜F）。 */
const COLS = 6;
/** クリア対象の行数（前回描画の残骸を確実に消す上限）。 */
const CLEAR_ROWS = 120;

/** 列幅（px）。A4縦・約700px幅を6列に配分（E=※源泉マーク列。源泉OFF時は極小化）。 */
const COLUMN_WIDTHS = [180, 70, 90, 90, 60, 110];
/** 源泉OFF時のE列幅（空列を視覚上ほぼ消す）。 */
const WITHHOLDING_COL_WIDTH_OFF = 12;
/** E列（※源泉マーク列）のインデックス。 */
const WITHHOLDING_COL_INDEX = 4;

/**
 * 数値書式（実機PDF目視の磨き込み・2026-07-24）:
 * '#,##0.###' も '#,##0.##' も、Sheets仕様で整数に小数点記号「1.」が表示される（実機確認2回目で判明）。
 * **数量列には numberFormat を設定しない**（自動表示: 1→1・1.5→1.5）。単価・金額='#,##0'。
 */
const FORMAT_AMOUNT = '#,##0';

/** 注記の折返し行高の見積り（8pt・A:F結合幅を1行約45文字で換算）。 */
const NOTE_CHARS_PER_LINE = 45;
function noteRowHeightPx(text: string): number {
  const lineCount = Math.max(1, Math.ceil(text.length / NOTE_CHARS_PER_LINE));
  return Math.max(21, 6 + lineCount * 14);
}

/** 書式用の色（Sheets APIは0..1のRGB）。 */
const COLOR_HEADER_BG = { red: 0xef / 255, green: 0xef / 255, blue: 0xef / 255 };
const COLOR_NOTE_TEXT = { red: 0x55 / 255, green: 0x55 / 255, blue: 0x55 / 255 };

type SheetsRequest = GoogleAppsScript.Sheets.Schema.Request;
type GridRange = GoogleAppsScript.Sheets.Schema.GridRange;

/** batchUpdate リクエスト列と export 用レンジ。 */
export interface TemplateRender {
  readonly requests: readonly SheetsRequest[];
  /** 出力範囲（A1形式。例 'A1:F58'）。 */
  readonly range: string;
}

/** 円表記。 */
function yen(value: number): string {
  return `¥${value.toLocaleString('ja-JP')}`;
}

/** 日付表記（スクリプトタイムゾーン=Asia/Tokyo前提。naming.ts と同じ割り切り）。 */
function dateTextJa(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}年${m}月${d}日`;
}

/** 0始まり行番号の GridRange（sheetId=0固定。列は全幅が既定）。 */
function rangeOf(sheetId: number, startRow: number, endRow: number, startCol = 0, endCol = COLS): GridRange {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

/** セル値配列 → RowData（number は numberValue・それ以外は stringValue）。 */
function toRowData(cells: readonly (string | number)[]): GoogleAppsScript.Sheets.Schema.RowData {
  return {
    values: cells.map((cell) => ({
      userEnteredValue: typeof cell === 'number' ? { numberValue: cell } : { stringValue: cell },
    })),
  };
}

/**
 * 帳票の batchUpdate リクエスト列を組み立てる（純関数）。
 * @param sheetId 描画先シートID（本番は scratch.ts の先頭シート=0）
 */
export function buildTemplateRequests(
  doc: DocumentData,
  result: CalcResult,
  profile: IssuerProfile,
  sheetId = 0,
): TemplateRender {
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
  pushRow(['', '', '', '発行日', '', dateTextJa(doc.issueDate)]);
  if (profile.taxable && profile.registrationNumber !== '') {
    pushRow(['', '', '', '登録番号', '', profile.registrationNumber]);
  }
  pushRow(['']);
  pushRow([`件名: ${doc.subject}`, '', '', profile.name]);
  pushRow([`取引年月日/期間: ${doc.transactionDate}`, '', '', profile.address]);
  const dueLabel = doc.type === 'invoice' ? 'お支払期限' : '有効期限';
  pushRow([doc.dueOrExpiry !== '' ? `${dueLabel}: ${doc.dueOrExpiry}` : '']);
  pushRow(['']);

  // ---- 金額サマリ（仕様確定・2026-07-24: 請求書=差引請求額・見積書=税込合計のまま）----
  // 源泉ONの請求書は「ご請求金額」=差引請求額とし、直下に税込合計・源泉税の内訳を小さく補助表示する。
  // 見積書は源泉ONでも「お見積金額」=税込合計（源泉徴収は支払時処理のため）。
  const headline = doc.type === 'invoice' ? 'ご請求金額' : 'お見積金額';
  const headlineAmount = doc.type === 'invoice' ? result.amountDue : result.total;
  const headlineRow = pushRow([headline, yen(headlineAmount)]);
  let headlineSubRow = 0;
  if (doc.type === 'invoice' && doc.withholdingEnabled && result.withholdingTax > 0) {
    headlineSubRow = pushRow([
      `（税込合計 ${yen(result.total)} ／ 源泉徴収税額 ▲${yen(result.withholdingTax)}）`,
    ]);
  }
  pushRow(['']);

  // ---- 明細表（E列=※源泉マーク。源泉計算ONのとき対象行に印を付ける）----
  const showWithholdingMark = doc.withholdingEnabled;
  const tableHeaderRow = pushRow([
    '品目',
    '数量',
    '単価（税抜）',
    '税率',
    showWithholdingMark ? '※源泉' : '',
    '金額（税抜）',
  ]);
  const has8 = result.lines.some((l) => l.taxCategory === '8');
  const hasWithholdingLine = showWithholdingMark && result.lines.some((l) => l.withholding);
  let firstItemRow = 0;
  let lastItemRow = 0;
  for (const line of result.lines) {
    const mark = line.taxCategory === '8' ? '※' : '';
    const row = pushRow([
      `${line.name}${mark}`,
      line.quantity,
      line.unitPrice,
      TAX_CATEGORY_LABELS[line.taxCategory],
      showWithholdingMark && line.withholding ? '※' : '',
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
  if (hasWithholdingLine) notes.push('※源泉＝源泉徴収の対象行');
  notes.push(...result.notes);
  if (doc.remarks !== '') notes.push(`備考: ${doc.remarks}`);
  let notesStart = 0;
  if (notes.length > 0) {
    notesStart = pushRow(['注記']);
    for (const note of notes) pushRow([note]);
  }

  const lastRow = rows.length;

  // ---- リクエスト列（クリア → 値 → 書式）----
  const requests: SheetsRequest[] = [];

  // 前回描画の結合・値・書式をクリア
  requests.push({ unmergeCells: { range: rangeOf(sheetId, 0, CLEAR_ROWS) } });
  requests.push({
    updateCells: { range: rangeOf(sheetId, 0, CLEAR_ROWS), fields: 'userEnteredValue,userEnteredFormat' },
  });

  // 値の一括書き込み
  requests.push({
    updateCells: {
      range: rangeOf(sheetId, 0, lastRow),
      fields: 'userEnteredValue',
      rows: rows.map(toRowData),
    },
  });

  // 基本書式（フォントサイズ10・上下中央）
  requests.push({
    repeatCell: {
      range: rangeOf(sheetId, 0, lastRow),
      cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(textFormat.fontSize,verticalAlignment)',
    },
  });

  // タイトル（結合・18pt太字・中央・行高）
  requests.push({ mergeCells: { range: rangeOf(sheetId, titleRow - 1, titleRow), mergeType: 'MERGE_ALL' } });
  requests.push({
    repeatCell: {
      range: rangeOf(sheetId, titleRow - 1, titleRow),
      cell: { userEnteredFormat: { textFormat: { fontSize: 18, bold: true }, horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: titleRow - 1, endIndex: titleRow },
      properties: { pixelSize: 40 },
      fields: 'pixelSize',
    },
  });

  // 宛名（12pt太字）
  requests.push({
    repeatCell: {
      range: rangeOf(sheetId, clientRow - 1, clientRow, 0, 1),
      cell: { userEnteredFormat: { textFormat: { fontSize: 12, bold: true } } },
      fields: 'userEnteredFormat.textFormat',
    },
  });

  // 金額サマリ（14pt太字・下罫線）
  requests.push({
    repeatCell: {
      range: rangeOf(sheetId, headlineRow - 1, headlineRow, 0, 2),
      cell: { userEnteredFormat: { textFormat: { fontSize: 14, bold: true } } },
      fields: 'userEnteredFormat.textFormat',
    },
  });
  requests.push({
    updateBorders: {
      range: rangeOf(sheetId, headlineRow - 1, headlineRow, 0, 2),
      bottom: { style: 'SOLID' },
    },
  });
  // 補助行（税込合計・源泉税の内訳。小さく灰色・A:F結合）
  if (headlineSubRow > 0) {
    requests.push({
      mergeCells: { range: rangeOf(sheetId, headlineSubRow - 1, headlineSubRow), mergeType: 'MERGE_ALL' },
    });
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, headlineSubRow - 1, headlineSubRow),
        cell: { userEnteredFormat: { textFormat: { fontSize: 9, foregroundColor: COLOR_NOTE_TEXT } } },
        fields: 'userEnteredFormat.textFormat(fontSize,foregroundColor)',
      },
    });
  }

  // 明細ヘッダ（太字・背景・罫線）
  requests.push({
    repeatCell: {
      range: rangeOf(sheetId, tableHeaderRow - 1, tableHeaderRow),
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: COLOR_HEADER_BG } },
      fields: 'userEnteredFormat(textFormat.bold,backgroundColor)',
    },
  });
  const tableEndRow = firstItemRow > 0 ? lastItemRow : tableHeaderRow;
  requests.push({
    updateBorders: {
      range: rangeOf(sheetId, tableHeaderRow - 1, tableEndRow),
      top: { style: 'SOLID' },
      bottom: { style: 'SOLID' },
      left: { style: 'SOLID' },
      right: { style: 'SOLID' },
      innerHorizontal: { style: 'SOLID' },
      innerVertical: { style: 'SOLID' },
    },
  });

  // 明細の数値書式（単価・金額=#,##0。数量列は numberFormat を設定しない＝末尾ピリオド表示の回避）
  if (firstItemRow > 0) {
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, firstItemRow - 1, lastItemRow, 2, 3),
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: FORMAT_AMOUNT } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, firstItemRow - 1, lastItemRow, COLS - 1, COLS),
        cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: FORMAT_AMOUNT } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
    // ※源泉マーク列は中央寄せ
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, firstItemRow - 1, lastItemRow, 4, 5),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    });
  }

  // 集計ブロック（外枠＋内側横罫線）
  requests.push({
    updateBorders: {
      range: rangeOf(sheetId, summaryStart - 1, summaryEnd, 3, COLS),
      top: { style: 'SOLID' },
      bottom: { style: 'SOLID' },
      left: { style: 'SOLID' },
      right: { style: 'SOLID' },
      innerHorizontal: { style: 'SOLID' },
    },
  });

  // 注記（見出し太字・本文8pt灰色。右端切れ対策: 各行をA:F結合＋WRAP＋行高確保）
  if (notesStart > 0) {
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, notesStart - 1, notesStart, 0, 1),
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    });
    requests.push({
      repeatCell: {
        range: rangeOf(sheetId, notesStart, notesStart + notes.length),
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 8, foregroundColor: COLOR_NOTE_TEXT },
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(textFormat.fontSize,textFormat.foregroundColor,wrapStrategy)',
      },
    });
    notes.forEach((note, index) => {
      const rowIndex = notesStart + index; // 0始まり（注記本文の各行）
      requests.push({ mergeCells: { range: rangeOf(sheetId, rowIndex, rowIndex + 1), mergeType: 'MERGE_ALL' } });
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
          properties: { pixelSize: noteRowHeightPx(note) },
          fields: 'pixelSize',
        },
      });
    });
  }

  // 列幅（E列=※源泉マーク列は源泉OFF時に極小化して空列の枠が目立たないようにする）
  COLUMN_WIDTHS.forEach((width, index) => {
    const pixelSize =
      index === WITHHOLDING_COL_INDEX && !showWithholdingMark ? WITHHOLDING_COL_WIDTH_OFF : width;
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    });
  });

  return { requests, range: `A1:F${lastRow}` };
}
