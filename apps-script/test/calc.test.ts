import { describe, it, expect } from 'vitest';
import {
  calcDocument,
  consumptionTaxOf,
  lineAmountOf,
  withholdingTaxOf,
  type CalcSettings,
  type LineItemInput,
  type RoundingMode,
  type TaxCategory,
} from '../src/server/calc';
import golden from './golden/calc.golden.json';

// golden（要件書§6-6 G-1〜G-11）。fixture は test/golden/calc.golden.json に固定し、
// **自動上書きしない**（引継書§10）。期待値の変更は人間のdiffレビューを要する。

/** fixture の文字列を型付きで読み直す（as any 禁止のため手動で絞り込む）。 */
function toTaxCategory(value: string): TaxCategory {
  if (value === '10' || value === '8' || value === 'none') return value;
  throw new Error(`fixtureの taxCategory が不正です: ${value}`);
}

function toRounding(value: string): RoundingMode {
  if (value === 'floor' || value === 'round' || value === 'ceil') return value;
  throw new Error(`fixtureの rounding が不正です: ${value}`);
}

function toWithholdingBase(value: string): 'exTax' | 'inTax' {
  if (value === 'exTax' || value === 'inTax') return value;
  throw new Error(`fixtureの withholdingBase が不正です: ${value}`);
}

describe('golden: 源泉所得税（G-1〜G-6）', () => {
  for (const c of golden.withholding) {
    it(`${c.id}: 対象額 ${c.base.toLocaleString('ja-JP')} → ${c.expected.toLocaleString('ja-JP')}`, () => {
      expect(withholdingTaxOf(c.base)).toBe(c.expected);
    });
  }
});

describe('golden: 消費税端数処理（G-7〜G-8）', () => {
  for (const c of golden.consumptionTax) {
    for (const mode of ['floor', 'round', 'ceil'] as const) {
      it(`${c.id}: ${c.ratePercent}%対象 ${c.subtotal.toLocaleString('ja-JP')} を${mode} → ${c.expected[mode]}`, () => {
        expect(consumptionTaxOf(c.subtotal, c.ratePercent, mode)).toBe(c.expected[mode]);
      });
    }
  }
});

describe('golden: 複合（G-9〜G-11）', () => {
  for (const c of golden.composite) {
    it(`${c.id}`, () => {
      const items: LineItemInput[] = c.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxCategory: toTaxCategory(item.taxCategory),
        withholding: item.withholding,
      }));
      const settings: CalcSettings = {
        rounding: toRounding(c.settings.rounding),
        withholdingEnabled: c.settings.withholdingEnabled,
        withholdingBase: toWithholdingBase(c.settings.withholdingBase),
      };
      const result = calcDocument(items, settings);
      const expected = c.expected;
      if ('tax10' in expected && typeof expected.tax10 === 'number') {
        expect(result.tax10).toBe(expected.tax10);
      }
      if ('tax8' in expected && typeof expected.tax8 === 'number') {
        expect(result.tax8).toBe(expected.tax8);
      }
      if ('withholdingTax' in expected && typeof expected.withholdingTax === 'number') {
        expect(result.withholdingTax).toBe(expected.withholdingTax);
      }
      expect(result.total).toBe(expected.total);
      if ('amountDue' in expected && typeof expected.amountDue === 'number') {
        expect(result.amountDue).toBe(expected.amountDue);
      }
    });
  }
});

describe('calcDocument の規則', () => {
  const base: CalcSettings = { rounding: 'floor', withholdingEnabled: false, withholdingBase: 'exTax' };

  it('明細額は数量×単価の1円未満切捨て（数量小数可）', () => {
    expect(lineAmountOf(1.5, 1000)).toBe(1500);
    expect(lineAmountOf(0.333, 10000)).toBe(3330);
    expect(lineAmountOf(3, 333.5)).toBe(1000); // 1000.5 → 1000
  });

  it('浮動小数の誤差で切上げが1円ずれない（100000×10%=10000ちょうど）', () => {
    expect(consumptionTaxOf(100000, 10, 'ceil')).toBe(10000);
    expect(consumptionTaxOf(100000, 10, 'floor')).toBe(10000);
  });

  it('消費税は明細行ごとではなく区分合計に対して1回だけ端数処理する（割戻し）', () => {
    // 行ごと切捨て（33+33+33=99）ではなく、合計999×10%=99.9→99 になることを確認。
    const items: LineItemInput[] = [1, 2, 3].map((i) => ({
      name: `行${i}`,
      quantity: 1,
      unitPrice: 333,
      taxCategory: '10',
      withholding: false,
    }));
    const result = calcDocument(items, base);
    expect(result.subtotal10).toBe(999);
    expect(result.tax10).toBe(99);
  });

  it('対象外区分には消費税を計上しない', () => {
    const result = calcDocument(
      [{ name: '立替交通費', quantity: 1, unitPrice: 5000, taxCategory: 'none', withholding: false }],
      base,
    );
    expect(result.subtotalExempt).toBe(5000);
    expect(result.taxTotal).toBe(0);
    expect(result.total).toBe(5000);
  });

  it('源泉OFFなら源泉税0・差引請求額=税込合計', () => {
    const result = calcDocument(
      [{ name: 'デザイン料', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true }],
      base,
    );
    expect(result.withholdingTax).toBe(0);
    expect(result.amountDue).toBe(result.total);
  });

  it('源泉ONでも対象行が無ければ源泉税0', () => {
    const result = calcDocument(
      [{ name: '物品', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: false }],
      { ...base, withholdingEnabled: true },
    );
    expect(result.withholdingTax).toBe(0);
    expect(result.amountDue).toBe(result.total);
  });

  it('税込基準では対象外区分の行は税を乗せずに合算する', () => {
    const result = calcDocument(
      [
        { name: '講演料', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true },
        { name: '立替費', quantity: 1, unitPrice: 10000, taxCategory: 'none', withholding: true },
      ],
      { rounding: 'floor', withholdingEnabled: true, withholdingBase: 'inTax' },
    );
    // 110,000（税込）+ 10,000（対象外はそのまま）= 120,000 → ×10.21% = 12,252
    expect(result.withholdingBaseAmount).toBe(120000);
    expect(result.withholdingTax).toBe(12252);
  });

  it('源泉の端数処理は合算後に1回だけ（行ごとに切捨てない）', () => {
    // 5円×10.21%=0.5105。行ごと切捨てなら 0+0=0 だが、
    // 合算後1回（10円×10.21%=1.021→切捨て）なら 1 になる。
    const result = calcDocument(
      [
        { name: 'A', quantity: 1, unitPrice: 5, taxCategory: 'none', withholding: true },
        { name: 'B', quantity: 1, unitPrice: 5, taxCategory: 'none', withholding: true },
      ],
      { rounding: 'floor', withholdingEnabled: true, withholdingBase: 'exTax' },
    );
    // 5×10.21%=0.5105 → 行ごとなら 0+0=0。合算後 10×10.21%=1.021 → 1。
    expect(result.withholdingTax).toBe(1);
  });

  it('notes に消費税・源泉の根拠が含まれる（N-1）', () => {
    const result = calcDocument(
      [{ name: '原稿料', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true }],
      { rounding: 'floor', withholdingEnabled: true, withholdingBase: 'exTax' },
    );
    expect(result.notes.some((n) => n.includes('税率区分ごとに切捨て') || n.includes('税率区分ごとに'))).toBe(true);
    expect(result.notes.some((n) => n.includes('10.21%'))).toBe(true);
    expect(result.notes.some((n) => n.includes('20.42%'))).toBe(true);
  });

  it('100万円ちょうどは10.21%側・超えた部分だけ20.42%（境界）', () => {
    expect(withholdingTaxOf(1_000_000)).toBe(102_100);
    expect(withholdingTaxOf(2_000_000)).toBe(102_100 + 204_200);
  });
});
