// 应用外壳测试：stub fetch 模拟服务 在线/离线，断言顶栏状态与状态页徽标。
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('服务在线：顶栏与状态页显示在线信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, service: 'fund-server' }), { status: 200 })),
    );
    render(<App />);
    await screen.findByText('服务在线 · fund-server');
    expect(screen.getByText('本地服务 127.0.0.1:17521')).toBeTruthy();
    expect(screen.getByText('在线')).toBeTruthy();
  });

  it('服务离线：顶栏显示离线，状态页给出启动指引', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    render(<App />);
    await screen.findByText('服务离线');
    expect(screen.getByText('离线')).toBeTruthy();
    expect(screen.getByText(/可在扩展面板点击状态卡片启动/)).toBeTruthy();
  });

  it('页签切换：买卖分析可进入', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, service: 'fund-server' }), { status: 200 })),
    );
    render(<App />);
    await screen.findByText('服务在线 · fund-server');
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.length;
    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/records')) {
        return new Response(
          JSON.stringify({
            ok: true,
            rows: [{ buyTime: '6-23', principal: 1000, buyNav: 4.8223, shares: 207.37, sellTime: null, sellNav: null, pnl: null }],
            realizedPnl: 0,
            soldPrincipal: 0,
            holdingPrincipal: 1000,
            holdingShares: 207.37,
            unmatchedSells: [],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, service: 'fund-server' }), { status: 200 });
    });
    void fetchCalls;
    screen.getByRole('button', { name: '买卖分析' }).click();
    await screen.findByText('买入时间');
  });
});
