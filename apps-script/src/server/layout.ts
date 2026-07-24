/**
 * シートレイアウト定数（FR-1/FR-2/FR-5。引継書§6「セル座標は layout.ts 定数に集約」）。
 *
 * 入力シート（1書類=1シート）・帳票シート「_帳票」・台帳シート「台帳」の
 * セル座標・行数はすべてここで定義する。他モジュールに座標リテラルを書かない。
 */

/** 書類種別。 */
export type DocumentType = 'quote' | 'invoice';

/** 書類種別の表示名。 */
export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  quote: '見積書',
  invoice: '請求書',
};

/** 表示名 → 書類種別（入力シートB1の逆引き）。 */
export function docTypeOfLabel(label: string): DocumentType | undefined {
  if (label === DOC_TYPE_LABELS.quote) return 'quote';
  if (label === DOC_TYPE_LABELS.invoice) return 'invoice';
  return undefined;
}

/** 入力シートのシート名プレフィックス（例:「請求書_INV-0001」）。 */
export function inputSheetNameOf(type: DocumentType, docNumber: string): string {
  return `${DOC_TYPE_LABELS[type]}_${docNumber}`;
}

/** 台帳シート名（FR-12）。 */
export const LEDGER_SHEET_NAME = '台帳';

/**
 * 入力シートのヘッダブロック（ラベルはA列・値はB列）。
 * 行番号は1始まり。
 */
export const INPUT_HEADER = {
  /** B1: 書類種別（見積書/請求書。docTypeOfLabel で逆引き）。 */
  docType: { row: 1, label: '書類種別' },
  /** B2: 書類番号（自動採番・手動上書き可）。 */
  docNumber: { row: 2, label: '書類番号' },
  /** B3: 発行日。 */
  issueDate: { row: 3, label: '発行日' },
  /** B4: 取引年月日または期間（文字列可）。 */
  transactionDate: { row: 4, label: '取引年月日/期間' },
  /** B5: 宛名（取引先名）。 */
  clientName: { row: 5, label: '宛名（取引先名）' },
  /** B6: 件名。 */
  subject: { row: 6, label: '件名' },
  /** B7: 支払期限（請求書）/有効期限（見積書）。 */
  dueOrExpiry: { row: 7, label: '' }, // ラベルは種別で切替（下の関数）
  /** B8: 振込先（請求書のみ使用）。 */
  bankInfo: { row: 8, label: '振込先' },
  /** B9: 源泉徴収を計算する（チェックボックス。既定はプロファイル設定値）。 */
  withholdingEnabled: { row: 9, label: '源泉徴収を計算する' },
} as const;

/** B7 のラベル（書類種別で切替）。 */
export function dueOrExpiryLabelOf(type: DocumentType): string {
  return type === 'invoice' ? '支払期限' : '有効期限';
}

/** ヘッダブロックの値列（B列）。 */
export const INPUT_VALUE_COL = 2;
/** ヘッダブロックのラベル列（A列）。 */
export const INPUT_LABEL_COL = 1;

/** 明細ブロック。 */
export const ITEMS = {
  /** 見出し行（品目/数量/単価/税率/源泉対象）。 */
  headerRow: 11,
  /** 明細開始行。 */
  startRow: 12,
  /** 明細行数（固定20行。引継書§6）。 */
  rowCount: 20,
  /** 列: A=品目, B=数量, C=単価(税抜), D=税率, E=源泉対象。 */
  col: { name: 1, quantity: 2, unitPrice: 3, taxCategory: 4, withholding: 5 },
  headers: ['品目', '数量', '単価（税抜）', '税率', '源泉対象'],
} as const;

/**
 * TaxCategory → 税率表示値（**唯一のラベル定義**。プルダウン・サンプル書込・パーサ・
 * エラーメッセージすべてがここを参照する）。
 *
 * 実機バグ（2026-07-24）: 表示値 '10%' は Sheets により数値 0.1 へ自動変換される
 * （setValueでもプルダウン選択でも発生）ため、**数値へ自動変換されない文字列**
 * 「10%（標準）」に統一した。'8%（軽減）'・'対象外' は非数値文字を含むため元から安全。
 */
export const TAX_CATEGORY_LABELS: Record<'10' | '8' | 'none', string> = {
  '10': '10%（標準）',
  '8': '8%（軽減）',
  none: '対象外',
};

/** 税率プルダウンの選択肢（表示値。TAX_CATEGORY_LABELS から導出）。 */
export const TAX_CATEGORY_OPTIONS = [
  TAX_CATEGORY_LABELS['10'],
  TAX_CATEGORY_LABELS['8'],
  TAX_CATEGORY_LABELS.none,
] as const;

/** 税率表示値 → TaxCategory 変換表（TAX_CATEGORY_LABELS の逆引き）。 */
export const TAX_CATEGORY_BY_LABEL: Record<string, '10' | '8' | 'none'> = {
  [TAX_CATEGORY_LABELS['10']]: '10',
  [TAX_CATEGORY_LABELS['8']]: '8',
  [TAX_CATEGORY_LABELS.none]: 'none',
};

/**
 * 税率セルの生値を TaxCategory に解釈する（純関数・堅牢化）。
 * 現行ラベルに加え、後方互換として次を受理する（既存シートの救済）:
 * - 数値 0.1／0.08（旧ラベル '10%' 等が Sheets により数値へ自動変換されたセル）
 * - 旧文字列ラベル '10%'／'8%'
 * 判定不能は undefined（呼び出し側がF-7エラーにする）。
 */
export function taxCategoryOfCellValue(raw: unknown): '10' | '8' | 'none' | undefined {
  if (typeof raw === 'number') {
    if (Math.abs(raw - 0.1) < 1e-9) return '10';
    if (Math.abs(raw - 0.08) < 1e-9) return '8';
    return undefined;
  }
  const label = String(raw ?? '').trim();
  const current = TAX_CATEGORY_BY_LABEL[label];
  if (current !== undefined) return current;
  if (label === '10%') return '10';
  if (label === '8%') return '8';
  return undefined;
}

/** 集計ブロック（GASが値を書く。ラベルはD列・値はE列に縦に並べる）。 */
export const SUMMARY = {
  startRow: 33,
  labelCol: 4,
  valueCol: 5,
  rows: {
    subtotal10: 33,
    tax10: 34,
    subtotal8: 35,
    tax8: 36,
    subtotalExempt: 37,
    subtotal: 38,
    taxTotal: 39,
    total: 40,
    withholdingTax: 41,
    amountDue: 42,
  },
  labels: {
    subtotal10: '10%対象（税抜）',
    tax10: '消費税（10%）',
    subtotal8: '8%対象（税抜）',
    tax8: '消費税（8%）',
    subtotalExempt: '対象外',
    subtotal: '小計（税抜）',
    taxTotal: '消費税合計',
    total: '税込合計',
    withholdingTax: '源泉徴収税額',
    amountDue: '差引請求額',
  },
} as const;

/** 計算根拠注記（N-1）ブロック。A列に1行1注記で書く。 */
export const NOTES = {
  headerRow: 44,
  headerLabel: '計算根拠（自動生成）',
  startRow: 45,
  maxRows: 6,
} as const;

/** 備考。 */
export const REMARKS = {
  labelRow: 52,
  label: '備考',
  valueRow: 53,
} as const;

/** 入力シートの使用範囲（初期化・書式設定用）。 */
export const INPUT_SHEET_ROWS = 60;
export const INPUT_SHEET_COLS = 6;

/** 台帳シートの列（FR-12: 発行日・書類種別・書類番号・取引先・税込金額・ファイルへのリンク）。 */
export const LEDGER_HEADERS = [
  '発行日',
  '書類種別',
  '書類番号',
  '取引先',
  '税込金額',
  'ファイルリンク',
] as const;

/** Drive 保存フォルダ名（FR-8）。 */
export const FOLDER_NAMES = {
  root: '帳票',
  invoice: '請求書',
  quote: '見積書',
} as const;
