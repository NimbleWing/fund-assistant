// 过程回放测试：stub fetch 模拟 timeline 序列，断言当前笔卡片、状态卡与步进交互。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '@/features/Timeline/Timeline';

afterEach(() => {
  vi.unstubAllGlobals();
});

const step = (over: Record<string, unknown>) => ({
  seq: 1,
  isSell: false,
  time: '1-1',
  nav: 2,
  amount: 1000,
  shares: 500,
  cost: 1200,
  holdingShares: 500,
  avgPrice: 2.4,
  invested: 1000,
  proceeds: 0,
  stepPnl: 0,
  realizedPnl: 0,
  ...over,
});

const MOCK_DATA = {
  ok: true,
  rows: [],
  realizedPnl: 0,
  soldPrincipal: 0,
  holdingPrincipal: 0,
  holdingShares: 0,
  unmatchedSells: [],
  anomalies: [],
  diluted: { cost: 0, costPrice: null, realizedPnl: 0 },
  totalBuyPrincipal: 0,
  sellProceeds: 0,
  accountBreakEvenNav: null,
  latestSellNav: null,
  timeline: [
    step({}),
    step({ seq: 2, time: '1-2', nav: 4, amount: 2000, shares: 250, cost: 3200, holdingShares: 750, avgPrice: 4.2667, invested: 3000 }),
    step({ seq: 3, isSell: true, time: '1-3', nav: 3, amount: 1500, shares: 500, cost: 1070, holdingShares: 250, avgPrice: 4.28, proceeds: 1500, stepPnl: -500, realizedPnl: -500 }),
  ],
};

describe('Timeline', () => {
  it('渲染首笔：当前笔卡片与状态卡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Timeline />);
    await screen.findByText(/第 1 笔/);
    expect(screen.getByText(/确认净值 2\.0000/)).toBeTruthy();
    expect(screen.getByText('2.4000')).toBeTruthy(); // 均价
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('步进：下一笔更新状态卡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Timeline />);
    await screen.findByText(/第 1 笔/);
    fireEvent.click(screen.getByRole('button', { name: '下一笔' }));
    expect(screen.getByText(/第 2 笔/)).toBeTruthy();
    expect(screen.getByText('4.2667')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一笔' }));
    expect(screen.getByText(/第 3 笔/)).toBeTruthy();
    expect(screen.getByText('卖出')).toBeTruthy();
    expect(screen.getAllByText('1500.00')).toHaveLength(2); // 当前笔回款 + 累计回款卡
    expect(screen.getAllByText('-500.00')).toHaveLength(2); // 本笔盈亏 + 累计已实现
  });

  it('播放按钮存在且可跳到末笔', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MOCK_DATA), { status: 200 })));
    render(<Timeline />);
    await screen.findByText(/第 1 笔/);
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy();
    const slider = screen.getByRole('slider');
    fireEvent.click(screen.getByRole('button', { name: '末笔' }));
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(slider).toBeTruthy();
  });
});
