import { describe, it, expect } from 'vitest';
import {
  buildPdfFileName,
  formatDateYmd,
  resolveNameCollision,
  sanitizeClientName,
} from '../src/server/naming';

describe('naming（FR-8・電帳法命名）', () => {
  it('既定命名は YYYYMMDD_取引先名_税込金額.pdf（国税庁例示の順序）', () => {
    expect(buildPdfFileName(new Date(2022, 9, 31), '㈱国税商事', 110000)).toBe(
      '20221031_㈱国税商事_110000.pdf',
    );
  });

  it('㈱等の記号はそのまま残す（国税庁例示準拠）', () => {
    expect(sanitizeClientName('㈱国税商事')).toBe('㈱国税商事');
    expect(sanitizeClientName('（同）テスト')).toBe('（同）テスト');
  });

  it('前後空白・改行・制御文字を除去する', () => {
    expect(sanitizeClientName('  株式会社テスト  ')).toBe('株式会社テスト');
    expect(sanitizeClientName('株式会社\nテスト')).toBe('株式会社テスト');
    expect(sanitizeClientName('テスト\u0000\u001f社')).toBe('テスト社');
  });

  it('/ 等のファイル名禁止文字は置換する', () => {
    expect(sanitizeClientName('A/B社')).toBe('A_B社');
    expect(sanitizeClientName('X:Y*Z?社')).toBe('X_Y_Z_社');
  });

  it('空になった取引先名はプレースホルダにする', () => {
    expect(sanitizeClientName('   ')).toBe('取引先未設定');
  });

  it('金額は整数化（切捨て）される', () => {
    expect(buildPdfFileName(new Date(2026, 6, 11), 'テスト', 110000.9)).toBe(
      '20260711_テスト_110000.pdf',
    );
  });

  it('日付ゼロ埋め', () => {
    expect(formatDateYmd(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('同名衝突は _2 からの連番', () => {
    const existing = new Set(['20260711_テスト_110000.pdf', '20260711_テスト_110000_2.pdf']);
    const resolved = resolveNameCollision('20260711_テスト_110000.pdf', (n) => existing.has(n));
    expect(resolved).toBe('20260711_テスト_110000_3.pdf');
  });

  it('衝突が無ければそのまま', () => {
    expect(resolveNameCollision('a.pdf', () => false)).toBe('a.pdf');
  });
});
