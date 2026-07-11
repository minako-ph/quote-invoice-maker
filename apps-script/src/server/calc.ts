/**
 * 計算エンジン（FR-3/FR-4・N-1。golden対象＝要件書§6-6）。
 *
 * 本アドオンの**唯一の計算源**（引継書§6）。シート数式で税計算を二重実装しない。
 * GAS グローバル（SpreadsheetApp 等）に依存しない純関数のみで構成し、vitest で検証する。
 *
 * 計算規則（引継書§6・要件書§6）:
 * 1. 明細額 = 数量 × 単価（税抜）を1円未満切捨てで整数化（数量は小数可）。
 * 2. 税率区分ごとに明細額を合計 → 消費税 = 区分合計 × 税率 を設定方式で**1回**端数処理
 *    （割戻し計算に固定。明細行ごとの端数処理→合算は行わない）。
 * 3. 源泉対象額: 税抜=対象行明細額の合計／税込=対象行明細額×(1+行税率) を端数処理せず合算。
 * 4. 源泉税 = 対象額に 10.21%（100万円超部分は 20.42% の二段階式）を適用し、
 *    **最後に1回だけ** 1円未満切捨て。
 * 5. 差引請求額 = 税込合計 − 源泉徴収税額。
 * 6. notes[] にすべての計算値の根拠文字列を生成する（N-1。根拠のない値は返さない）。
 *
 * 浮動小数の誤差対策: 税額・源泉税は「整数の積 ÷ 10^n」の形に正規化してから端数処理する
 * （例: 10% は sum*10/100、10.21% は base100*1021/1000000）。真値が整数のとき float 誤差で
 * 切上げ・切捨てが1円ずれる事故（100000*0.1=10000.000000000002 等）を構造的に避ける。
 */

/** 税率区分。'10'=標準10%／'8'=軽減8%／'none'=対象外（不課税・非課税等）。 */
export type TaxCategory = '10' | '8' | 'none';

/** 消費税の端数処理方式（要件書§6-2。事業者の任意選択→設定。既定=切捨て）。 */
export type RoundingMode = 'floor' | 'round' | 'ceil';

/** 源泉対象額の基準（要件書§6-1。既定=税抜、設定で税込に切替可）。 */
export type WithholdingBase = 'exTax' | 'inTax';

/** 明細1行の入力。 */
export interface LineItemInput {
  /** 品目名（空行は明細から除外して呼び出す）。 */
  readonly name: string;
  /** 数量（小数可）。 */
  readonly quantity: number;
  /** 単価（税抜・円）。 */
  readonly unitPrice: number;
  /** 税率区分。 */
  readonly taxCategory: TaxCategory;
  /** 源泉徴収の対象行か。 */
  readonly withholding: boolean;
}

/** 計算設定（発行者プロファイル・書類単位トグルから供給する）。 */
export interface CalcSettings {
  /** 消費税の端数処理方式（既定 'floor'）。 */
  readonly rounding: RoundingMode;
  /** 源泉徴収税額を計算するか（書類単位トグル）。 */
  readonly withholdingEnabled: boolean;
  /** 源泉対象額の基準（既定 'exTax'）。 */
  readonly withholdingBase: WithholdingBase;
}

/** 明細1行の計算結果。 */
export interface LineItemResult {
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly taxCategory: TaxCategory;
  readonly withholding: boolean;
  /** 明細額 = 数量×単価 の1円未満切捨て（整数・円）。 */
  readonly amount: number;
}

/** 書類全体の計算結果（帳票・集計ブロック・台帳が参照する唯一の値）。 */
export interface CalcResult {
  readonly lines: readonly LineItemResult[];
  /** 税率区分ごとの税抜合計（円）。 */
  readonly subtotal10: number;
  readonly subtotal8: number;
  readonly subtotalExempt: number;
  /** 税抜合計（全区分。円）。 */
  readonly subtotal: number;
  /** 税率区分ごとの消費税額（設定方式で区分ごと1回端数処理済み。円）。 */
  readonly tax10: number;
  readonly tax8: number;
  /** 消費税合計（円）。 */
  readonly taxTotal: number;
  /** 税込合計（円）。 */
  readonly total: number;
  /** 源泉対象額（円。表示用に1円未満を四捨五入した参考値ではなく、切捨て前の真値を100倍整数で保持した上での円換算値）。 */
  readonly withholdingBaseAmount: number;
  /** 源泉徴収税額（円。合算後に1回だけ切捨て）。 */
  readonly withholdingTax: number;
  /** 差引請求額 = 税込合計 − 源泉徴収税額（円）。 */
  readonly amountDue: number;
  /** すべての自動計算値の根拠（N-1。帳票注記・サイドバーに表示する）。 */
  readonly notes: readonly string[];
}

/** 既定の計算設定。 */
export const DEFAULT_SETTINGS: CalcSettings = {
  rounding: 'floor',
  withholdingEnabled: false,
  withholdingBase: 'exTax',
};

/** 端数処理方式の表示名（N-1 の根拠文字列・設定UIで使用）。 */
export const ROUNDING_LABELS: Record<RoundingMode, string> = {
  floor: '切捨て',
  round: '四捨五入',
  ceil: '切上げ',
};

/** 税率区分ごとの税率（%）。 */
const RATE_PERCENT: Record<Exclude<TaxCategory, 'none'>, number> = { '10': 10, '8': 8 };

/** 源泉徴収の二段階境界（円）＝100万円。 */
const WITHHOLDING_TIER_THRESHOLD = 1_000_000;

/** 指定方式で1円未満を端数処理する。 */
function roundBy(value: number, mode: RoundingMode): number {
  if (mode === 'floor') return Math.floor(value);
  if (mode === 'ceil') return Math.ceil(value);
  return Math.round(value);
}

/**
 * 明細額 = 数量 × 単価 の1円未満切捨て（整数化）。
 * 数量の小数（例 1.5×1000=1500）で float 誤差が出ても崩れないよう、
 * 小数第6位で丸めてから切捨てる。
 */
export function lineAmountOf(quantity: number, unitPrice: number): number {
  const raw = quantity * unitPrice;
  const stabilized = Math.round(raw * 1e6) / 1e6;
  return Math.floor(stabilized);
}

/**
 * 源泉徴収税額（要件書§6-1。golden G-1〜G-6）。
 *
 * @param base100 対象額×100（整数。税込基準の 8% 行 ×1.08 でも整数で表せるよう100倍で受ける）
 * @returns 税額（円・整数。合算後に1回だけ1円未満切捨て）
 *
 * A≦100万円 → A×10.21%／A＞100万円 → (A−100万円)×20.42%＋102,100円。
 * 整数演算で分子を作ってから最後に1回割る（float 誤差の構造的回避）。
 */
export function withholdingTaxOf100(base100: number): number {
  const threshold100 = WITHHOLDING_TIER_THRESHOLD * 100;
  if (base100 <= threshold100) {
    return Math.floor((base100 * 1021) / 1_000_000);
  }
  return Math.floor(((base100 - threshold100) * 2042) / 1_000_000 + 102_100);
}

/** 源泉徴収税額（対象額が整数円のときの便宜ラッパ。golden G-1〜G-6 が使用）。 */
export function withholdingTaxOf(baseAmount: number): number {
  return withholdingTaxOf100(baseAmount * 100);
}

/**
 * 消費税額 = 税抜区分合計 × 税率 を指定方式で1回端数処理（要件書§6-2。golden G-7/G-8）。
 * sum×rate% を整数の積で作ってから100で割る（float 誤差の構造的回避）。
 */
export function consumptionTaxOf(subtotal: number, ratePercent: number, mode: RoundingMode): number {
  return roundBy((subtotal * ratePercent) / 100, mode);
}

/**
 * 書類全体を計算する（唯一の計算源）。
 * 空行（品目が空で数量・単価とも0）は呼び出し側で除外してから渡すこと。
 */
export function calcDocument(items: readonly LineItemInput[], settings: CalcSettings): CalcResult {
  const lines: LineItemResult[] = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxCategory: item.taxCategory,
    withholding: item.withholding,
    amount: lineAmountOf(item.quantity, item.unitPrice),
  }));

  const sumOf = (category: TaxCategory): number =>
    lines.filter((l) => l.taxCategory === category).reduce((acc, l) => acc + l.amount, 0);

  const subtotal10 = sumOf('10');
  const subtotal8 = sumOf('8');
  const subtotalExempt = sumOf('none');
  const subtotal = subtotal10 + subtotal8 + subtotalExempt;

  const tax10 = consumptionTaxOf(subtotal10, RATE_PERCENT['10'], settings.rounding);
  const tax8 = consumptionTaxOf(subtotal8, RATE_PERCENT['8'], settings.rounding);
  const taxTotal = tax10 + tax8;
  const total = subtotal + taxTotal;

  // 源泉対象額（×100 の整数で保持。税込基準は行税率を乗せて端数処理せず合算＝規則3）。
  let base100 = 0;
  if (settings.withholdingEnabled) {
    for (const line of lines) {
      if (!line.withholding) continue;
      if (settings.withholdingBase === 'inTax' && line.taxCategory !== 'none') {
        base100 += line.amount * (100 + RATE_PERCENT[line.taxCategory]);
      } else {
        base100 += line.amount * 100;
      }
    }
  }
  const withholdingBaseAmount = base100 / 100;
  const withholdingTax = settings.withholdingEnabled ? withholdingTaxOf100(base100) : 0;
  const amountDue = total - withholdingTax;

  const notes = buildNotes(settings, { subtotal10, subtotal8, base100, withholdingTax });

  return {
    lines,
    subtotal10,
    subtotal8,
    subtotalExempt,
    subtotal,
    tax10,
    tax8,
    taxTotal,
    total,
    withholdingBaseAmount,
    withholdingTax,
    amountDue,
    notes,
  };
}

/**
 * 計算根拠の注記（N-1）。帳票の注記欄・サイドバーにそのまま表示する。
 * 「根拠のない値は返さない」＝計算に使った規則をすべて文字列化する。
 */
function buildNotes(
  settings: CalcSettings,
  values: {
    readonly subtotal10: number;
    readonly subtotal8: number;
    readonly base100: number;
    readonly withholdingTax: number;
  },
): string[] {
  const notes: string[] = [];
  const roundingLabel = ROUNDING_LABELS[settings.rounding];

  notes.push(
    `消費税は税率区分ごとに${roundingLabel}（1書類につき税率ごとに1回・割戻し計算）`,
  );
  if (values.subtotal10 > 0) {
    notes.push(`10%対象 ${formatYen(values.subtotal10)}円 × 10% を${roundingLabel}`);
  }
  if (values.subtotal8 > 0) {
    notes.push(`8%対象（軽減税率） ${formatYen(values.subtotal8)}円 × 8% を${roundingLabel}`);
  }

  if (settings.withholdingEnabled) {
    const baseLabel = settings.withholdingBase === 'exTax' ? '税抜' : '税込';
    notes.push(
      `源泉徴収税額＝${baseLabel}報酬額×10.21%（100万円超部分は20.42%）・1円未満切捨て`,
    );
    notes.push(`源泉対象額は${baseLabel}金額を基準に算出（対象行のみ合算・端数処理は最後に1回）`);
    notes.push('源泉徴収の要否・対象該当性の判断は利用者にてお願いします（税務助言ではありません）');
  }

  return notes;
}

/** 3桁区切りの円表記（注記用）。 */
function formatYen(value: number): string {
  return value.toLocaleString('ja-JP');
}
