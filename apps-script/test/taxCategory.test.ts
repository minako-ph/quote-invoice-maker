import { describe, it, expect } from 'vitest';
import {
  TAX_CATEGORY_BY_LABEL,
  TAX_CATEGORY_LABELS,
  TAX_CATEGORY_OPTIONS,
  taxCategoryOfCellValue,
} from '../src/server/layout';
import { SAMPLE_ITEMS } from '../src/server/sample';

// 実機バグ（2026-07-24）: 旧ラベル '10%' が Sheets により数値 0.1 へ自動変換され、
// パーサが解釈不能→F-7エラーになった。ラベルの数値非変換化＋パーサ堅牢化の回帰テスト。

describe('税率ラベル定数（1箇所集約）', () => {
  it('ラベルは数値へ自動変換されない文字列（純粋な percent 表記を含まない）', () => {
    for (const label of TAX_CATEGORY_OPTIONS) {
      // '10%' のような「数値+%」だけのラベルは Sheets が 0.1 に自動変換するため禁止
      expect(/^\d+(\.\d+)?%$/.test(label)).toBe(false);
    }
    expect(TAX_CATEGORY_LABELS['10']).toBe('10%（標準）');
    expect(TAX_CATEGORY_LABELS['8']).toBe('8%（軽減）');
    expect(TAX_CATEGORY_LABELS.none).toBe('対象外');
  });

  it('OPTIONS・BY_LABEL は LABELS から導出されて整合している', () => {
    expect(TAX_CATEGORY_OPTIONS).toEqual([
      TAX_CATEGORY_LABELS['10'],
      TAX_CATEGORY_LABELS['8'],
      TAX_CATEGORY_LABELS.none,
    ]);
    for (const [code, label] of Object.entries(TAX_CATEGORY_LABELS)) {
      expect(TAX_CATEGORY_BY_LABEL[label]).toBe(code);
    }
  });
});

describe('taxCategoryOfCellValue（パーサ堅牢化）', () => {
  it('往復: サンプル生成データ一式（コード→ラベル→パーサ）が元のコードに戻る', () => {
    for (const item of SAMPLE_ITEMS) {
      const label = TAX_CATEGORY_LABELS[item.taxCategory];
      expect(taxCategoryOfCellValue(label)).toBe(item.taxCategory);
    }
  });

  it('数値 0.1／0.08 のセル（旧ラベルの自動変換結果）を受理する', () => {
    expect(taxCategoryOfCellValue(0.1)).toBe('10');
    expect(taxCategoryOfCellValue(0.08)).toBe('8');
    // 浮動小数の表現ゆらぎも許容
    expect(taxCategoryOfCellValue(0.1 + 1e-12)).toBe('10');
  });

  it('旧文字列ラベル 10%／8% を受理する（既存シート救済）', () => {
    expect(taxCategoryOfCellValue('10%')).toBe('10');
    expect(taxCategoryOfCellValue('8%')).toBe('8');
    expect(taxCategoryOfCellValue(' 10% ')).toBe('10');
  });

  it('判定不能は undefined（F-7エラーの入口）', () => {
    expect(taxCategoryOfCellValue('')).toBeUndefined();
    expect(taxCategoryOfCellValue('15%')).toBeUndefined();
    expect(taxCategoryOfCellValue(0.05)).toBeUndefined();
    expect(taxCategoryOfCellValue(null)).toBeUndefined();
    expect(taxCategoryOfCellValue(undefined)).toBeUndefined();
  });
});
