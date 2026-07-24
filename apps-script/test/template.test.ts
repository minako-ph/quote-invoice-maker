import { describe, it, expect } from 'vitest';
import { calcDocument, type CalcSettings } from '../src/server/calc';
import { DEFAULT_PROFILE, type IssuerProfile } from '../src/server/profile';
import type { DocumentData } from '../src/server/sheets';
import { buildTemplateRequests } from '../src/server/template';

// buildTemplateRequests（V-1確定構成の帳票描画リクエスト生成・純関数）のテスト。
// golden（calc）とは独立に、生成される updateCells の値に記載要件・根拠注記が現れることを検証する。

const PROFILE_TAXABLE: IssuerProfile = {
  ...DEFAULT_PROFILE,
  name: 'テスト発行者',
  address: '東京都千代田区1-1-1',
  registrationNumber: 'T1234567890123',
  taxable: true,
  bankInfo: 'テスト銀行 本店 普通 1234567',
};

const PROFILE_EXEMPT: IssuerProfile = {
  ...DEFAULT_PROFILE,
  name: 'テスト発行者',
  taxable: false,
  registrationNumber: '',
};

const SETTINGS_G9: CalcSettings = { rounding: 'floor', withholdingEnabled: true, withholdingBase: 'exTax' };

function makeDoc(overrides: Partial<DocumentData> = {}): DocumentData {
  return {
    type: 'invoice',
    docNumber: 'I-0001',
    issueDate: new Date(2026, 6, 24),
    transactionDate: '2026年7月',
    clientName: 'テスト株式会社',
    subject: 'テスト件名',
    dueOrExpiry: '2026/08/31',
    bankInfo: PROFILE_TAXABLE.bankInfo,
    withholdingEnabled: true,
    items: [
      { name: 'デザイン料', quantity: 1, unitPrice: 100000, taxCategory: '10', withholding: true },
    ],
    remarks: '',
    ...overrides,
  };
}

/** updateCells リクエストから全セルを {row, col, value} で抽出する。 */
function extractCells(
  requests: readonly GoogleAppsScript.Sheets.Schema.Request[],
): { row: number; col: number; value: string | number }[] {
  const cells: { row: number; col: number; value: string | number }[] = [];
  for (const request of requests) {
    const update = request.updateCells;
    if (update === undefined || update.rows === undefined) continue;
    update.rows.forEach((rowData, rowIndex) => {
      (rowData.values ?? []).forEach((cell, colIndex) => {
        const v = cell.userEnteredValue;
        if (v === undefined) return;
        if (typeof v.stringValue === 'string') cells.push({ row: rowIndex, col: colIndex, value: v.stringValue });
        else if (typeof v.numberValue === 'number') cells.push({ row: rowIndex, col: colIndex, value: v.numberValue });
      });
    });
  }
  return cells;
}

function stringValues(cells: { value: string | number }[]): string[] {
  return cells.map((c) => String(c.value));
}

describe('buildTemplateRequests（FR-5/6・N-1）', () => {
  it('① 適格（課税）は登録番号行あり・免税は登録番号なし＋税込対価の区分記載', () => {
    const doc = makeDoc();
    const result = calcDocument(doc.items, SETTINGS_G9);

    const taxable = stringValues(extractCells([...buildTemplateRequests(doc, result, PROFILE_TAXABLE).requests]));
    expect(taxable).toContain('登録番号');
    expect(taxable).toContain('T1234567890123');
    expect(taxable).toContain('10%対象（税抜）');
    expect(taxable).toContain('消費税（10%）');

    const exempt = stringValues(extractCells([...buildTemplateRequests(doc, result, PROFILE_EXEMPT).requests]));
    expect(exempt).not.toContain('登録番号');
    expect(exempt).not.toContain('T1234567890123');
    // 区分記載: 税率ごとの税込対価の額（100,000+10,000）
    expect(exempt).toContain('10%対象（税込）');
    expect(exempt).toContain('¥110,000');
    expect(exempt.some((v) => v.includes('消費税（10%）'))).toBe(false);
  });

  it('② 源泉ONで源泉徴収税額・差引請求額の行が出る／OFFでは出ない', () => {
    const docOn = makeDoc({ withholdingEnabled: true });
    const resultOn = calcDocument(docOn.items, SETTINGS_G9);
    const valuesOn = stringValues(extractCells([...buildTemplateRequests(docOn, resultOn, PROFILE_TAXABLE).requests]));
    expect(valuesOn).toContain('源泉徴収税額');
    expect(valuesOn).toContain('差引請求額');

    const docOff = makeDoc({ withholdingEnabled: false });
    const resultOff = calcDocument(docOff.items, { ...SETTINGS_G9, withholdingEnabled: false });
    const valuesOff = stringValues(
      extractCells([...buildTemplateRequests(docOff, resultOff, PROFILE_TAXABLE).requests]),
    );
    expect(valuesOff).not.toContain('源泉徴収税額');
    expect(valuesOff).not.toContain('差引請求額');
  });

  it('③ G-9入力の合計・源泉・差引がラベルと同じ行の金額列（F列）に現れる', () => {
    const doc = makeDoc();
    const result = calcDocument(doc.items, SETTINGS_G9);
    expect(result.total).toBe(110000);
    expect(result.withholdingTax).toBe(10210);
    expect(result.amountDue).toBe(99790);

    const cells = extractCells([...buildTemplateRequests(doc, result, PROFILE_TAXABLE).requests]);
    const AMOUNT_COL = 5; // F列（0始まり）

    const amountOfLabel = (label: string): string | number | undefined => {
      const labelCell = cells.find((c) => c.value === label);
      if (labelCell === undefined) return undefined;
      return cells.find((c) => c.row === labelCell.row && c.col === AMOUNT_COL)?.value;
    };

    expect(amountOfLabel('合計（税込）')).toBe('¥110,000');
    expect(amountOfLabel('源泉徴収税額')).toBe('-¥10,210');
    expect(amountOfLabel('差引請求額')).toBe('¥99,790');
  });

  it('④ N-1根拠注記（端数処理・源泉税率の式）が含まれる', () => {
    const doc = makeDoc();
    const result = calcDocument(doc.items, SETTINGS_G9);
    const values = stringValues(extractCells([...buildTemplateRequests(doc, result, PROFILE_TAXABLE).requests]));
    expect(values).toContain('注記');
    expect(values.some((v) => v.includes('税率区分ごとに切捨て'))).toBe(true);
    expect(values.some((v) => v.includes('10.21%') && v.includes('20.42%'))).toBe(true);
  });

  it('export用rangeは A1:F{最終行} 形式', () => {
    const doc = makeDoc();
    const result = calcDocument(doc.items, SETTINGS_G9);
    const { range } = buildTemplateRequests(doc, result, PROFILE_TAXABLE);
    expect(range).toMatch(/^A1:F\d+$/);
  });
});
