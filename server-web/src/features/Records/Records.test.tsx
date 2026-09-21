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
  holdingShares: 637.82,
  unmatchedSells: [{ time: '9-10', shares: 999 }],
  anomalies: [],
};

describe('Records', () => {
  it('渲染配对行、持有行与汇总', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Records />);
    await screen.findByText('6-23');
    expect(screen.getAllByText('-318.63')).toHaveLength(2); // 汇总卡 + 表格行
    expect(screen.getByText('持有中')).toBeTruthy();
    expect(screen.getAllByText('2000.00')).toHaveLength(2); // 汇总卡 + 表格行
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
    expect(screen.getByText(/份额 2122.28（按本金\/净值应为 212.28）/)).toBeTruthy();
  });
});
