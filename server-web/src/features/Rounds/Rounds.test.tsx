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
      floatingPnlPct: 86.1, totalPnlPct: 86.1, sharesHeld30d: 250,
    },
    openBuys: [{ id: 11, date: '2026-09-01', nav: 2, shares: 500, principal: 1000 }],
    buyPnls: [{ id: 11, holdingShares: 500, realizedPnl: 0, floatingPnl: 861 }],
    txns: [{ id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0, pairBuyId: null }],
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
    expect(screen.getAllByText('+861.00').length).toBe(4); // 浮动/摊薄/轮总盈亏 + 买入行盈亏（未卖出按最新净值）
    expect(screen.getAllByText('+86.10%').length).toBe(2); // 浮动盈亏率 + 轮总盈亏率独立指标
    expect(screen.getByText('满30天份额')).toBeTruthy();
    expect(screen.getByText('250.00')).toBeTruthy(); // sharesHeld30d
    expect(screen.getByText(/3\.7220/)).toBeTruthy(); // 最新净值
    expect(screen.getByRole('button', { name: '清仓闭轮' })).toHaveProperty('disabled', true);
  });

  it('买入行盈亏列：已清仓显示已实现（卖出净值口径），部分卖出显示合计并标注构成，卖出行显示 —', async () => {
    const round = makeRound({
      openBuys: [{ id: 12, date: '2026-09-02', nav: 4, shares: 250, principal: 1000 }],
      buyPnls: [
        { id: 11, holdingShares: 0, realizedPnl: 250, floatingPnl: null },
        { id: 12, holdingShares: 250, realizedPnl: 125, floatingPnl: -250 },
      ],
      txns: [
        { id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0, pairBuyId: null },
        { id: 12, direction: 'buy', date: '2026-09-02', amount: 2000, nav: 4, shares: 500, fee: 0, pairBuyId: null },
        { id: 13, direction: 'sell', date: '2026-09-10', amount: 2250, nav: 3, shares: 750, fee: 0, pairBuyId: null },
      ],
    });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    expect(screen.getByText('+250.00')).toBeTruthy(); // 批次 11 已清仓：已实现
    expect(screen.getByText('-125.00')).toBeTruthy(); // 批次 12 合计：125 + (−250)
    expect(screen.getByText(/（已卖 \+125\.00 · 持有 -250\.00）/)).toBeTruthy();
  });

  it('指标 ⓘ 点击弹出计算公式气泡，再点关闭', async () => {
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [makeRound()] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getAllByRole('button', { name: '浮动盈亏计算公式' })[0]!);
    await screen.findByRole('tooltip');
    expect(screen.getByRole('tooltip').textContent).toContain('浮动盈亏 = 持仓市值 − 持有本金');
    fireEvent.click(screen.getAllByRole('button', { name: '浮动盈亏计算公式' })[0]!);
    expect(screen.queryByRole('tooltip')).toBeNull();
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

  it('买入行内卖出：点击卖出按钮自动配对（份额锁定带出），提交带 pairBuyId；✕ 取消配对', async () => {
    const round = makeRound(); // openBuys 含 id=11 的 500 份买入
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
    // 初始为买入方向，确认份额可编辑
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).disabled).toBe(false);
    // 点击买入行的「卖出」按钮 → 自动切卖出方向 + 配对提示 + 份额锁定为该批次剩余份额
    fireEvent.click(screen.getByRole('button', { name: '卖出' }));
    await screen.findByText(/配对 2026-09-01 买入/);
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).value).toBe('500');
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).disabled).toBe(true);
    // ✕ 取消配对 → 回到自动 FIFO，份额恢复可编辑
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect((screen.getByLabelText('确认份额') as HTMLInputElement).disabled).toBe(false);
    // 重新发起配对并提交
    fireEvent.click(screen.getByRole('button', { name: '卖出' }));
    await screen.findByText(/配对 2026-09-01 买入/);
    fireEvent.change(screen.getByLabelText('确认净值'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: '录入' }));
    await vi.waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/txns') && (c[1] as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ direction: 'sell', shares: 500, pairBuyId: 11 });
    });
  });

  it('买入行标识：已清仓买入无卖出按钮；被显式配对的买入标注「已配对卖出」，卖出行回指配对日期', async () => {
    const round = makeRound({
      openBuys: [],
      txns: [
        { id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0, pairBuyId: null },
        { id: 12, direction: 'sell', date: '2026-09-10', amount: 1250, nav: 2.5, shares: 500, fee: 0, pairBuyId: 11 },
      ],
    });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    expect(screen.getByText('（已配对卖出）')).toBeTruthy();
    expect(screen.getByText(/（配对 2026-09-01）/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '卖出' })).toBeNull();
  });

  it('交易表过滤：买入 / 卖出 / 未匹配买入（有剩余份额的批次，含部分卖出）', async () => {
    // 买 11（500 份，被卖 13 消耗 300 份，剩 200）、买 12（300 份已耗尽）、卖 13（FIFO 消耗）
    const round = makeRound({
      openBuys: [{ id: 11, date: '2026-09-01', nav: 2, shares: 200, principal: 400 }],
      txns: [
        { id: 11, direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500, fee: 0, pairBuyId: null },
        { id: 12, direction: 'buy', date: '2026-09-02', amount: 600, nav: 2, shares: 300, fee: 0, pairBuyId: null },
        { id: 13, direction: 'sell', date: '2026-09-10', amount: 750, nav: 2.5, shares: 300, fee: 0, pairBuyId: null },
      ],
    });
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    // 默认全部：3 行
    expect(screen.getAllByRole('button', { name: '删除' }).length).toBe(3);
    // 只显示卖出
    fireEvent.click(screen.getByRole('button', { name: '只看卖出' }));
    expect(screen.getAllByRole('button', { name: '删除' }).length).toBe(1);
    expect(screen.getByText('2026-09-10')).toBeTruthy();
    // 只显示买入
    fireEvent.click(screen.getByRole('button', { name: '只看买入' }));
    expect(screen.getAllByRole('button', { name: '删除' }).length).toBe(2);
    expect(screen.queryByText('2026-09-10')).toBeNull();
    // 只显示未匹配买入：仅剩有剩余份额的买入 11
    fireEvent.click(screen.getByRole('button', { name: '未匹配买入' }));
    expect(screen.getAllByRole('button', { name: '删除' }).length).toBe(1);
    expect(screen.getByText(/（剩 200/)).toBeTruthy();
    expect(screen.queryByText('2026-09-02')).toBeNull();
  });

  it('过滤空态：无匹配记录时提示', async () => {
    // 只有买入、无卖出 → 切到「卖出」过滤显示空态
    stubApi((url) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [makeRound()] }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getByRole('button', { name: '只看卖出' }));
    await screen.findByText('当前过滤条件下暂无交易记录');
  });

  it('删除失败时展示服务端错误（如被配对买入不可删）', async () => {
    const round = makeRound();
    stubApi((url, init) => {
      if (url.includes('/api/rounds?fund=')) {
        return new Response(JSON.stringify({ ok: true, rounds: [round] }), { status: 200 });
      }
      if (url.includes('/txns/') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: false, error: '该买入已被卖出显式配对，请先删除对应卖出记录' }), { status: 200 });
      }
      return null;
    });
    render(<Rounds />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByText('该买入已被卖出显式配对，请先删除对应卖出记录');
  });
});
