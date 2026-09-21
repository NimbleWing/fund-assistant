// 轮次页测试：基金选择加载、开轮、录入（份额自动带出）、闭轮禁用/成功、历史轮展开。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rounds } from '@/features/Rounds/Rounds';
import type { RoundData } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const FUND = { id: 1, code: '018994', name: '中欧数字经济混合发起C', type: '混合型', created_at: '', updated_at: '' };

function makeRound(over: Partial<RoundData> = {}): RoundData {
  return {
    id: 1,
    fundCode: '018994',
    seq: 1,
    status: 'active',
    createdAt: '2026-09-01T00:00:00Z',
    closedAt: null,
    metrics: {
      buyCount: 1, sellCount: 0, invested: 1000, proceeds: 0, realizedPnl: 0, soldPrincipal: 0,
      holdingPrincipal: 1000, holdingShares: 500, dilutedCost: 1000, dilutedRealizedPnl: 0,
      latestNav: 3.722, marketValue: 1861, floatingPnl: 861, dilutedHoldingPnl: 861, totalPnl: 861,
    },
    txns: [{ id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500 }],
    ...over,
  };
}

/** URL 感知 stub：watchlist + rounds 路由；behavior 可覆盖 rounds GET 返回值。 */
function stubApi(handler?: (url: string, init?: RequestInit) => Response | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const custom = handler?.(url, init);
      if (custom) return custom;
      if (url.includes('/api/watchlist')) {
        return new Response(JSON.stringify({ ok: true, rows: [FUND] }), { status: 200 });
      }
      if (url.includes('/api/rounds')) {
        return new Response(JSON.stringify({ ok: true, rounds: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
}

describe('Rounds', () => {
  it('加载基金列表并拉取轮次；无轮次时空态提示', async () => {
    stubApi();
    render(<Rounds />);
    await screen.findByText(/该基金还没有轮次/);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/rounds?fund=018994'))).toBe(true);
  });

  it('进行中轮：指标卡片 + 交易表渲染，闭轮按钮禁用（有持仓）', async () => {
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [makeRound()] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    expect(screen.getByText('进行中')).toBeTruthy();
    expect(screen.getByText('持仓收益·摊薄（对账）')).toBeTruthy();
    expect(screen.getAllByText('+861.00').length).toBeGreaterThanOrEqual(1); // 浮动/摊薄/总盈亏
    expect(screen.getByText(/3\.7220/)).toBeTruthy(); // 最新净值
    expect(screen.getByRole('button', { name: '清仓闭轮' })).toHaveProperty('disabled', true);
  });

  it('录入买入：份额按 金额÷净值 自动带出，提交后更新', async () => {
    const round = makeRound({ txns: [], metrics: { ...makeRound().metrics, buyCount: 0, invested: 0, holdingPrincipal: 0, holdingShares: 0, marketValue: 0, floatingPnl: 0, dilutedHoldingPnl: 0, totalPnl: 0, dilutedCost: 0 } });
    stubApi((url, init) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      if (url.includes('/txns') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, round: makeRound() }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    fireEvent.change(screen.getByLabelText('本金'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('确认净值'), { target: { value: '2' } });
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).value).toBe('500');
    fireEvent.click(screen.getByRole('button', { name: '录入' }));
    await screen.findByText('买入'); // 交易行出现
    const post = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/txns'));
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ direction: 'buy', amount: 1000, nav: 2, shares: 500 });
  });

  it('已清仓轮：快照表格渲染，展开查看交易明细', async () => {
    const closedRound = makeRound({
      status: 'closed',
      closedAt: '2026-09-21T12:00:00Z',
      metrics: { ...makeRound().metrics, holdingPrincipal: 0, holdingShares: 0, marketValue: null, floatingPnl: null, dilutedHoldingPnl: null, totalPnl: 500, realizedPnl: 500 },
    });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [closedRound] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('已清仓');
    expect(screen.getAllByText('+500.00').length).toBeGreaterThanOrEqual(1); // 已实现盈亏与轮总盈亏
    expect(screen.queryByRole('button', { name: '清仓闭轮' })).toBeNull(); // 无进行中轮
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    await screen.findByRole('button', { name: '收起' });
    expect(screen.getAllByText('2026-09-01').length).toBeGreaterThanOrEqual(1);
  });

  it('开轮按钮：有进行中轮时禁用', async () => {
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [makeRound()] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    expect(screen.getByRole('button', { name: '开始新一轮' })).toHaveProperty('disabled', true);
  });
});
