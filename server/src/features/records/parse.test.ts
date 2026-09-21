// parseRecords 单测：分类解析、配对（含重复份额 FIFO）、盈亏、持有、无匹配卖出、脏行跳过。
import { describe, expect, it } from 'vitest';
import { parseRecords } from './parse.ts';

describe('parseRecords', () => {
  it('买入分类与字段解析（含行尾空白）', () => {
    const r = parseRecords('6-23 1000 4.8223 207.37  \n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ buyTime: '6-23', principal: 1000, buyNav: 4.8223, shares: 207.37 });
    expect(r.rows[0].sellTime).toBeNull();
  });

  it('配对与盈亏：份额×卖出净值−买入本金', () => {
    const r = parseRecords('1-1 1000 2 500\n- 1-2 1000 2.5 500\n');
    expect(r.rows[0]).toMatchObject({ sellTime: '1-2', sellNav: 2.5, pnl: 250 });
    expect(r.realizedPnl).toBe(250);
    expect(r.soldPrincipal).toBe(1000);
    expect(r.holdingPrincipal).toBe(0);
  });

  it('重复份额：卖出按 FIFO 配对最早的买入', () => {
    const r = parseRecords('1-1 1000 2 500\n1-2 1000 2.2 500\n- 1-3 1000 3 500\n- 1-4 1000 3.5 500\n');
    expect(r.rows[0]).toMatchObject({ sellTime: '1-3', pnl: 500 });
    expect(r.rows[1]).toMatchObject({ sellTime: '1-4', pnl: 750 });
  });

  it('未卖出买入：持有中，盈亏 null', () => {
    const r = parseRecords('1-1 1000 2 500\n1-2 2000 4 250\n- 1-3 1000 2.5 500\n');
    expect(r.rows[0].pnl).toBe(250);
    expect(r.rows[1].pnl).toBeNull();
    expect(r.holdingPrincipal).toBe(2000);
    expect(r.holdingShares).toBe(250);
  });

  it('卖出找不到同份额买入：进 unmatchedSells，不影响其余配对', () => {
    const r = parseRecords('1-1 1000 2 500\n- 1-2 1000 2.5 999\n');
    expect(r.unmatchedSells).toHaveLength(1);
    expect(r.unmatchedSells[0]).toMatchObject({ time: '1-2', shares: 999 });
    expect(r.rows[0].pnl).toBeNull();
    expect(r.realizedPnl).toBe(0);
  });

  it('脏行与空行跳过', () => {
    const r = parseRecords('\n垃圾行\n1-1 1000 2 500\n1-1 abc 2 500\n1-1 1000 2\n- 1-2 1000 2.5 500\n');
    expect(r.rows).toHaveLength(1);
    expect(r.realizedPnl).toBe(250);
  });

  it('汇总：多条配对合计（含亏损）', () => {
    const r = parseRecords('1-1 1000 2 500\n1-2 2000 8 250\n- 1-3 1000 3 500\n- 1-4 2000 7.2 250\n');
    expect(r.realizedPnl).toBe(300); // (500×3−1000) + (250×7.2−2000) = 500 − 200
    expect(r.soldPrincipal).toBe(3000);
  });

  it('异常检测：买入份额与 本金÷净值 偏差 >1% 时进 anomalies', () => {
    const r = parseRecords('6-25 1000 4.7108 2122.28\n');
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ time: '6-25', shares: 2122.28, expectedShares: 212.28 });
  });

  it('异常检测：两位小数舍入误差不算异常', () => {
    const r = parseRecords('6-29 4000 4.7041 850.32\n'); // 4000/4.7041 = 850.315… → 850.32
    expect(r.anomalies).toHaveLength(0);
  });
});
