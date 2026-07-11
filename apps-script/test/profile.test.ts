import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROFILE,
  REGISTRATION_NUMBER_PATTERN,
  normalizeProfile,
  validateProfile,
} from '../src/server/profile';

describe('profile（FR-11）', () => {
  it('登録番号はT+13桁の形式チェックのみ（CR-1: 真正性検証をしない）', () => {
    expect(REGISTRATION_NUMBER_PATTERN.test('T1234567890123')).toBe(true);
    expect(REGISTRATION_NUMBER_PATTERN.test('T123456789012')).toBe(false); // 12桁
    expect(REGISTRATION_NUMBER_PATTERN.test('T12345678901234')).toBe(false); // 14桁
    expect(REGISTRATION_NUMBER_PATTERN.test('1234567890123')).toBe(false); // Tなし
    expect(REGISTRATION_NUMBER_PATTERN.test('t1234567890123')).toBe(false); // 小文字
  });

  it('課税＋不正形式はエラー・正しい形式はOK', () => {
    const bad = validateProfile({ ...DEFAULT_PROFILE, taxable: true, registrationNumber: 'T12' });
    expect(bad.ok).toBe(false);
    const good = validateProfile({
      ...DEFAULT_PROFILE,
      taxable: true,
      registrationNumber: 'T1234567890123',
    });
    expect(good.ok).toBe(true);
  });

  it('課税＋未入力は許容（登録番号の入力は任意）', () => {
    expect(validateProfile({ ...DEFAULT_PROFILE, taxable: true, registrationNumber: '' }).ok).toBe(true);
  });

  it('免税モードで登録番号を設定するとエラー（区分記載に登録番号様の番号を載せない）', () => {
    const result = validateProfile({
      ...DEFAULT_PROFILE,
      taxable: false,
      registrationNumber: 'T1234567890123',
    });
    expect(result.ok).toBe(false);
  });

  it('normalizeProfile は欠損・型不一致を既定値で補う', () => {
    expect(normalizeProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(normalizeProfile({ name: 'テスト', rounding: 'bogus' })).toEqual({
      ...DEFAULT_PROFILE,
      name: 'テスト',
    });
    expect(normalizeProfile({ rounding: 'ceil', withholdingBase: 'inTax' })).toEqual({
      ...DEFAULT_PROFILE,
      rounding: 'ceil',
      withholdingBase: 'inTax',
    });
  });
});
