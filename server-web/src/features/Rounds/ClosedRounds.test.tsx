// 已清仓轮次页测试：快照表格渲染（只含已清仓）、展开交易明细、空态。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClosedRounds } from '@/features/Rounds/ClosedRounds';
import type { RoundData } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const FUND = { id: 1, code: '018994', name: '中欧数字经济混合发起C', type: '混合型', created_at: '', updated_at: '' };

const CLOSED: RoundData = {
  id: 1,
  fundCode: '018994',
  seq: 1,
  status: 'closed',
  createdAt: '2026-09-01T00:00:00Z',
  closedAt: '2026-09-21T12:00:00Z',
  metrics: {
    buyCount: 2, sellCount: 1, invested: 3000, proceeds: 3500, realizedPnl: 500, soldPrincipal: 3000,
    holdingPrincipal: 0, holdingShares: 0, dilutedCost: 0, dilutedRealizedPnl: 500,
    latestNav: null, marketValue: null, floatingPnl: null, dilutedHoldingPnl: null, totalPnl: 500,
    floatingPnlPct: null, totalPnlPct: 16.67, sharesHeld30d: 0,
  },
  openBuys: [],
  buyPnls: [],
  txns: [
    { id: 1, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0, pairBuyId: null },
    { id: 2, direction: 'buy', date: '2026-09-08', amount: 2000, nav: 4, shares: 500, fee: 0, pairBuyId: null },
    { id: 3, direction: 'sell', date: '2026-09-21', amount: 3500, nav: 3.5, shares: 1000, fee: 5, pairBuyId: null },
  ],
};

const ACTIVE: RoundData = { ...CLOSED, id: 2, seq: 2, status: 'active', closedAt: null };

function stubApi(rounds: RoundData[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/watchlist')) {
        return new Response(JSON.stringify({ ok: true, rows: [FUND] }), { status: 200 });
      }
      if (url.includes('/api/rounds')) {
        return new Response(JSON.stringify({ ok: true, rounds }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
}

describe('ClosedRounds', () => {
  it('只展示已清仓轮（快照值直读），进行中轮不显示', async () => {
    stubApi([CLOSED, ACTIVE]);
    render(<ClosedRounds />);
    await screen.findByText('已清仓');
    expect(screen.getByText('第 1 轮')).toBeTruthy();
    expect(screen.queryByText('第 2 轮')).toBeNull();
    expect(screen.getAllByText('+500.00').length).toBe(2); // 已实现盈亏 + 轮总盈亏
    expect(screen.getByText('+16.67%')).toBeTruthy(); // 轮总盈亏率独立列
  });

  it('表头 ⓘ 点击弹出计算公式气泡', async () => {
    stubApi([CLOSED]);
    render(<ClosedRounds />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getAllByRole('button', { name: '轮总盈亏计算公式' })[0]!);
    await screen.findByRole('tooltip');
    expect(screen.getByRole('tooltip').textContent).toContain('轮总盈亏 = 持仓市值 + 累计回款 − 轮总投入');
  });

  it('展开查看交易明细（含手续费）', async () => {
    stubApi([CLOSED]);
    render(<ClosedRounds />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    await screen.findByRole('button', { name: '收起' });
    expect(screen.getByText('手续费 5.00')).toBeTruthy();
    expect(screen.getAllByText('2026-09-21').length).toBeGreaterThanOrEqual(1);
  });

  it('空态引导', async () => {
    stubApi([]);
    render(<ClosedRounds />);
    await screen.findByText(/暂无已清仓轮次/);
  });
});
