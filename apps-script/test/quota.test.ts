import { describe, it, expect } from 'vitest';
import {
  FREE_MONTHLY_LIMIT,
  PRO_MONTHLY_LIMIT,
  parseUsage,
  remainingOf,
} from '../src/server/quota';

describe('quota（FR-9・純関数部）', () => {
  it('無料枠は月3枚・Proは月1,000枚（docs記載と一致。変更禁止＝§13）', () => {
    expect(FREE_MONTHLY_LIMIT).toBe(3);
    expect(PRO_MONTHLY_LIMIT).toBe(1000);
  });

  it('未保存は used=0 で現在月に初期化', () => {
    expect(parseUsage(null, '2026-07')).toEqual({ month: '2026-07', used: 0 });
    expect(parseUsage('', '2026-07')).toEqual({ month: '2026-07', used: 0 });
  });

  it('月替りで自動リセット', () => {
    const stored = JSON.stringify({ month: '2026-06', used: 3 });
    expect(parseUsage(stored, '2026-07')).toEqual({ month: '2026-07', used: 0 });
  });

  it('同月内は使用数を維持', () => {
    const stored = JSON.stringify({ month: '2026-07', used: 2 });
    expect(parseUsage(stored, '2026-07')).toEqual({ month: '2026-07', used: 2 });
  });

  it('壊れたJSON・不正値は0に正規化', () => {
    expect(parseUsage('{broken', '2026-07').used).toBe(0);
    expect(parseUsage(JSON.stringify({ month: '2026-07', used: -1 }), '2026-07').used).toBe(0);
    expect(parseUsage(JSON.stringify({ month: '2026-07', used: 1.5 }), '2026-07').used).toBe(0);
    expect(parseUsage(JSON.stringify({ month: '2026-07', used: '2' }), '2026-07').used).toBe(0);
  });

  it('残数は負にならない', () => {
    expect(remainingOf({ month: '2026-07', used: 5 }, FREE_MONTHLY_LIMIT)).toBe(0);
    expect(remainingOf({ month: '2026-07', used: 1 }, FREE_MONTHLY_LIMIT)).toBe(2);
  });
});
