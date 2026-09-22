// market/status 单测：交易时段边界（周末/盘前/盘中/午休/收盘）。
import { describe, expect, it } from 'vitest';
import { isMarketOpen, marketLabel } from './status.ts';

/** 构造本地时间：2026-09-21 为周一，2026-09-26 为周六。 */
function at(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00`);
}

describe('isMarketOpen', () => {
  it('工作日连续竞价时段为开盘中', () => {
    expect(isMarketOpen(at('2026-09-21', '09:30'))).toBe(true);
    expect(isMarketOpen(at('2026-09-21', '11:29'))).toBe(true);
    expect(isMarketOpen(at('2026-09-21', '13:00'))).toBe(true);
    expect(isMarketOpen(at('2026-09-21', '14:59'))).toBe(true);
  });

  it('盘前/午休/收盘后/周末为休市', () => {
    expect(isMarketOpen(at('2026-09-21', '09:29'))).toBe(false);
    expect(isMarketOpen(at('2026-09-21', '11:30'))).toBe(false);
    expect(isMarketOpen(at('2026-09-21', '12:59'))).toBe(false);
    expect(isMarketOpen(at('2026-09-21', '15:00'))).toBe(false);
    expect(isMarketOpen(at('2026-09-26', '10:00'))).toBe(false);
  });

  it('marketLabel 与开休市一致', () => {
    expect(marketLabel(at('2026-09-21', '10:00'))).toBe('开盘中');
    expect(marketLabel(at('2026-09-26', '10:00'))).toBe('休市');
  });
});
