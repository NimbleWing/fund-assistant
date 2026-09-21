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
    txns: [{ id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0 }],
    ...over,
  };
}

/** URL 感知 stub：watchlist + rounds + navs 路由；behavior 可覆盖 rounds GET 返回值。 */
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
      if (url.includes('/api/funds/018994/navs')) {
        return new Response(
          JSON.stringify({ ok: true, fund: FUND, rows: [{ id: 1, date: '2026-09-01', unitNav: 2, createdAt: '' }] }),
          { status: 200 },
        );
      }
      if (url.includes('/api/rounds')) {
        return new Response(JSON.stringify({ ok: true, rounds: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
}

describe('Rounds', () => {
  it('加载基金列表并拉取轮次；无进行中轮时空态提示', async () => {
    stubApi();
    render(<Rounds />);
    await screen.findByText(/没有进行中的轮次/);
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

  it('已清仓轮不在当前轮次页展示', async () => {
    const closedRound = makeRound({ status: 'closed', closedAt: '2026-09-21T12:00:00Z' });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [closedRound] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText(/没有进行中的轮次/);
    expect(screen.queryByText('已清仓')).toBeNull();
  });

  it('选择买入时间自动匹配确认净值，输入本金自动算份额；无净值记录日期给出提示', async () => {
    const round = makeRound({ txns: [] });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    // 选中有净值记录的日期 → 确认净值自动带出
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2026-09-01' } });
    await vi.waitFor(() => expect((screen.getByLabelText('确认净值') as HTMLInputElement).value).toBe('2'));
    // 输入本金 → 份额自动算
    fireEvent.change(screen.getByLabelText('本金'), { target: { value: '1000' } });
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).value).toBe('500');
    // 无净值记录的日期 → 提示手动输入
    fireEvent.change(screen.getByLabelText('买入时间'), { target: { value: '2026-09-06' } });
    await screen.findByText(/该日期无净值记录/);
  });

  it('卖出：手续费参与回款建议（份额 × 净值 − 手续费），随表单提交', async () => {
    const round = makeRound(); // 持有 500 份
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
    fireEvent.change(screen.getByLabelText('方向'), { target: { value: 'sell' } });
    fireEvent.change(screen.getByLabelText('卖出时间'), { target: { value: '2026-09-01' } });
    await vi.waitFor(() => expect((screen.getByLabelText('确认净值') as HTMLInputElement).value).toBe('2'));
    fireEvent.change(screen.getByLabelText('确认份额'), { target: { value: '500' } });
    expect((screen.getByLabelText('回款（实际到账）') as HTMLInputElement).value).toBe('1000');
    fireEvent.change(screen.getByLabelText('手续费'), { target: { value: '10' } });
    expect((screen.getByLabelText('回款（实际到账）') as HTMLInputElement).value).toBe('990');
    fireEvent.click(screen.getByRole('button', { name: '录入' }));
    await vi.waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/txns') && (c[1] as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ direction: 'sell', amount: 990, nav: 2, shares: 500, fee: 10 });
    });
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
