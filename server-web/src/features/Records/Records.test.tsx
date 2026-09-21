// 临时分析页测试：stub fetch 模拟 /api/records，断言配对行、持有行与错误提示。
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Records } from '@/features/Records/Records';

afterEach(() => {
  vi.unstubAllGlobals();
});

const MOCK_DATA = {
  ok: true,
  rows: [
    { buyTime: '6-23', principal: 1000, buyNav: 4.8223, shares: 207.37, sellTime: '8-03', sellNav: 3.3026, pnl: -318.63 },
    { buyTime: '7-31', principal: 2000, buyNav: 3.1357, shares: 637.82, sellTime: null, sellNav: null, pnl: null },
  ],
  realizedPnl: -318.63,
  soldPrincipal: 1000,
  holdingPrincipal: 2000,
  holdingShares: 1000,
  unmatchedSells: [{ time: '9-10', shares: 999 }],
  anomalies: [],
  diluted: { cost: 3000, costPrice: 3, realizedPnl: -100 },
  totalBuyPrincipal: 3000,
  sellProceeds: 1500,
  accountBreakEvenNav: 6,
  latestSellNav: 3.68,
  timeline: [],
};

describe('Records', () => {
  it('渲染配对行、持有行与汇总', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Records />);
    await screen.findByText('6-23');
    expect(screen.getAllByText('-318.63')).toHaveLength(2); // 汇总卡 + 表格行
    await screen.findByTitle(/持有中/); // 持有行（净值默认已填，显示浮动盈亏）
    expect(screen.getAllByText('2000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('最新净值默认取最后卖出净值，双口径金额联动计算', async () => {
    localStorage.removeItem('records-latest-nav');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Records />);
    // 默认净值 3.68 × 份额 1000 → 市值 3680
    await screen.findByText('3680.00');
    // 摊薄持仓收益 = 3680 − 3000 = 680；浮动 = 3680 − 2000 = 1680；账户总 = 3680 + 1500 − 3000 = 2180
    expect(screen.getAllByText('+680.00')).toHaveLength(1);
    expect(screen.getByText('+1680.00')).toBeTruthy();
    expect(screen.getByText('+2180.00')).toBeTruthy();
    // 回本净值展示
    expect(screen.getByText(/摊薄口径 3\.0000 · 账户回本 6\.0000/)).toBeTruthy();
    // 持有行（637.82 份 × 3.68 − 2000 = +347.18）
    expect(screen.getByText('+347.18')).toBeTruthy();
  });

  it('未匹配卖出提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Records />);
    await screen.findByText(/1 条卖出未找到同份额买入/);
    expect(screen.getByText(/9-10（999 份）/)).toBeTruthy();
  });

  it('文件缺失：显示错误提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '未找到记录文件' }), { status: 200 })),
    );
    render(<Records />);
    await screen.findByText('未找到记录文件');
  });

  it('异常买入提示：显示推算份额', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...MOCK_DATA,
            anomalies: [{ time: '6-25', principal: 1000, nav: 4.7108, shares: 2122.28, expectedShares: 212.28 }],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Records />);
    await screen.findByText(/1 条买入份额与 本金÷净值 偏差过大/);
    expect(screen.getByText(/份额 2122\.28（按本金\/净值应为 212\.28）/)).toBeTruthy();
  });
});
