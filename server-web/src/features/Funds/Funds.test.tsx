// 基金搜索页测试：stub fetch 模拟 /api/funds/search 与 /api/watchlist，
// 断言结果渲染、失败态、竞态丢弃与关注/取消关注交互。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Funds } from '@/features/Funds/Funds';

afterEach(() => {
  vi.unstubAllGlobals();
});

const HITS = [
  { code: '001003', name: '华夏债券C', type: '债券型-混合一级' },
  { code: '000001', name: '华夏成长混合', type: '混合型-灵活' },
];

const WATCH_ROW = { id: 1, code: '001003', name: '华夏债券C', type: '债券型-混合一级', created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z' };

/** URL 感知 stub：关注列表 GET 返回 watchlist，搜索返回 hits，其余默认 ok。 */
function stubApi(opts: { hits?: typeof HITS; watchlist?: typeof WATCH_ROW[] } = {}) {
  const { hits = HITS, watchlist = [] } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/funds/search')) {
        return new Response(JSON.stringify({ ok: true, hits }), { status: 200 });
      }
      if (url.includes('/api/watchlist') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, row: WATCH_ROW }), { status: 200 });
      }
      if (url.includes('/api/watchlist') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true, removed: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, rows: watchlist }), { status: 200 });
    }),
  );
}

describe('Funds', () => {
  it('输入关键词后渲染结果表', async () => {
    stubApi();
    render(<Funds debounceMs={0} />);
    fireEvent.change(screen.getByLabelText('基金代码 / 名称'), { target: { value: '华夏' } });
    await screen.findByText('001003');
    expect(screen.getByText('华夏债券C')).toBeTruthy();
    expect(screen.getByText('债券型-混合一级')).toBeTruthy();
    expect(screen.getByText('2 条结果')).toBeTruthy();
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.at(-1)).toContain(`/api/funds/search?q=${encodeURIComponent('华夏')}`);
  });

  it('无结果与远端失败提示', async () => {
    stubApi({ hits: [] });
    render(<Funds debounceMs={0} />);
    const input = screen.getByLabelText('基金代码 / 名称');
    fireEvent.change(input, { target: { value: '不存在' } });
    await screen.findByText(/无匹配基金/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/funds/search')) {
          return new Response(JSON.stringify({ ok: false, error: '远端失败' }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 });
      }),
    );
    fireEvent.change(input, { target: { value: '华夏' } });
    await screen.findByText(/搜索服务暂不可用/);
  });

  it('清空输入回到初始态且不再请求', async () => {
    stubApi();
    render(<Funds debounceMs={0} />);
    const input = screen.getByLabelText('基金代码 / 名称');
    fireEvent.change(input, { target: { value: '华夏' } });
    await screen.findByText('001003');
    const calls = vi.mocked(fetch).mock.calls.length;
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText('001003')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it('竞态：旧请求的慢响应被丢弃，不覆盖新结果', async () => {
    // 第一次搜索请求挂起不返回，第二次立即返回；随后手动放行第一次
    const resolvers: Array<(r: Response) => void> = [];
    let searchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/funds/search')) {
          searchCalls += 1;
          if (searchCalls === 1) {
            return new Promise<Response>((resolve) => {
              resolvers.push(resolve);
            });
          }
          const hits = url.includes(encodeURIComponent('华夏成长')) ? [HITS[1]] : HITS;
          return Promise.resolve(new Response(JSON.stringify({ ok: true, hits }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 }));
      }),
    );
    render(<Funds debounceMs={0} />);
    const input = screen.getByLabelText('基金代码 / 名称');
    fireEvent.change(input, { target: { value: '华夏' } });
    // 等第一次搜索请求真正发出（挂起中），再输入新关键词触发第二次请求
    await vi.waitFor(() => expect(searchCalls).toBe(1));
    fireEvent.change(input, { target: { value: '华夏成长' } });
    await screen.findByText('000001');
    expect(screen.queryByText('001003')).toBeNull();
    // 放行挂起的旧请求（其 signal 已被 abort，但即便返回也应被序号丢弃）
    resolvers[0]?.(new Response(JSON.stringify({ ok: true, hits: HITS }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('001003')).toBeNull();
    expect(screen.getByText('华夏成长混合')).toBeTruthy();
  });

  it('关注 → 已关注 → 取消关注', async () => {
    stubApi();
    render(<Funds debounceMs={0} />);
    fireEvent.change(screen.getByLabelText('基金代码 / 名称'), { target: { value: '华夏' } });
    const followBtns = await screen.findAllByRole('button', { name: '关注' });
    expect(followBtns).toHaveLength(2);

    // 关注第一行：POST /api/watchlist，按钮变「已关注」
    fireEvent.click(followBtns[0] as HTMLElement);
    await screen.findByRole('button', { name: '已关注' });
    const post = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/api/watchlist') && (c[1] as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ code: '001003', name: '华夏债券C', type: '债券型-混合一级' });

    // 取消关注：DELETE /api/watchlist/001003，按钮恢复「关注」
    fireEvent.click(screen.getByRole('button', { name: '已关注' }));
    await screen.findAllByRole('button', { name: '关注' });
    const del = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).includes('/api/watchlist/001003') && (c[1] as RequestInit)?.method === 'DELETE');
    expect(del).toBeTruthy();
  });

  it('已在关注列表的基金进入搜索即显示「已关注」', async () => {
    stubApi({ watchlist: [WATCH_ROW] });
    render(<Funds debounceMs={0} />);
    fireEvent.change(screen.getByLabelText('基金代码 / 名称'), { target: { value: '华夏' } });
    await screen.findByRole('button', { name: '已关注' });
  });
});
