// 基金搜索页测试：stub fetch 模拟 /api/funds/search，断言结果渲染、失败态与竞态丢弃。
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

function stubOk(hits = HITS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true, hits }), { status: 200 })),
  );
}

describe('Funds', () => {
  it('输入关键词后渲染结果表', async () => {
    stubOk();
    render(<Funds debounceMs={0} />);
    fireEvent.change(screen.getByLabelText('基金代码 / 名称'), { target: { value: '华夏' } });
    await screen.findByText('001003');
    expect(screen.getByText('华夏债券C')).toBeTruthy();
    expect(screen.getByText('债券型-混合一级')).toBeTruthy();
    expect(screen.getByText('2 条结果')).toBeTruthy();
    const url = String(vi.mocked(fetch).mock.calls.at(-1)?.[0]);
    expect(url).toContain(`/api/funds/search?q=${encodeURIComponent('华夏')}`);
  });

  it('无结果与远端失败提示', async () => {
    stubOk([]);
    render(<Funds debounceMs={0} />);
    const input = screen.getByLabelText('基金代码 / 名称');
    fireEvent.change(input, { target: { value: '不存在' } });
    await screen.findByText(/无匹配基金/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '远端失败' }), { status: 200 })),
    );
    fireEvent.change(input, { target: { value: '华夏' } });
    await screen.findByText(/搜索服务暂不可用/);
  });

  it('清空输入回到初始态且不再请求', async () => {
    stubOk();
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
    // 第一次请求挂起不返回，第二次立即返回；随后手动放行第一次
    const resolvers: Array<(r: Response) => void> = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        call += 1;
        const url = String(input);
        if (call === 1) {
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        }
        const hits = url.includes(encodeURIComponent('华夏成长')) ? [HITS[1]] : HITS;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, hits }), { status: 200 }));
      }),
    );
    render(<Funds debounceMs={0} />);
    const input = screen.getByLabelText('基金代码 / 名称');
    fireEvent.change(input, { target: { value: '华夏' } });
    // 等第一次请求真正发出（挂起中），再输入新关键词触发第二次请求
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: '华夏成长' } });
    await screen.findByText('000001');
    expect(screen.queryByText('001003')).toBeNull();
    // 放行挂起的旧请求（其 signal 已被 abort，但即便返回也应被序号丢弃）
    resolvers[0]?.(new Response(JSON.stringify({ ok: true, hits: HITS }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText('001003')).toBeNull();
    expect(screen.getByText('华夏成长混合')).toBeTruthy();
  });
});
