// 关注列表页测试：渲染表格、空态、取消关注后本地移除、加载失败提示。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Watchlist } from '@/features/Watchlist/Watchlist';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROWS = [
  { id: 1, code: '001003', name: '华夏债券C', type: '债券型-混合一级', created_at: '2026-09-21T08:00:00Z', updated_at: '2026-09-21T08:00:00Z' },
  { id: 2, code: '000001', name: '华夏成长混合', type: null, created_at: '2026-09-21T09:00:00Z', updated_at: '2026-09-21T09:00:00Z' },
];

function stubList(rows: typeof ROWS | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true, removed: true }), { status: 200 });
      }
      if (rows == null) return new Response(JSON.stringify({ ok: false, error: 'db 异常' }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, rows }), { status: 200 });
    }),
  );
}

describe('Watchlist', () => {
  it('渲染关注列表（类型缺失显示 —）', async () => {
    stubList(ROWS);
    render(<Watchlist onOpenFund={() => {}} />);
    await screen.findByText('001003');
    expect(screen.getByText('华夏成长混合')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '取消关注' })).toHaveLength(2);
  });

  it('空列表引导去搜索页', async () => {
    stubList([]);
    render(<Watchlist onOpenFund={() => {}} />);
    await screen.findByText(/暂无关注基金/);
  });

  it('点击基金名称触发 onOpenFund 进入详情页', async () => {
    stubList(ROWS);
    const onOpenFund = vi.fn();
    render(<Watchlist onOpenFund={onOpenFund} />);
    await screen.findByText('001003');
    fireEvent.click(screen.getByRole('button', { name: '华夏债券C' }));
    expect(onOpenFund).toHaveBeenCalledWith(expect.objectContaining({ code: '001003', name: '华夏债券C' }));
  });

  it('加载失败提示', async () => {
    stubList(null);
    render(<Watchlist onOpenFund={() => {}} />);
    await screen.findByText(/关注列表加载失败/);
  });

  it('取消关注：DELETE 后行即时移除', async () => {
    stubList(ROWS);
    render(<Watchlist onOpenFund={() => {}} />);
    await screen.findByText('001003');
    fireEvent.click(screen.getAllByRole('button', { name: '取消关注' })[0] as HTMLElement);
    await vi.waitFor(() => expect(screen.queryByText('001003')).toBeNull());
    expect(screen.getByText('000001')).toBeTruthy();
    const del = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit)?.method === 'DELETE');
    expect(String(del?.[0])).toContain('/api/watchlist/001003');
  });
});
