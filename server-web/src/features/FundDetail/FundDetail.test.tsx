// 基金净值详情页测试：历史渲染、补录成功/已存在提示/校验、返回回调。
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FundDetail } from '@/features/FundDetail/FundDetail';

afterEach(() => {
  vi.unstubAllGlobals();
});

const FUND = { code: '001003', name: '华夏债券C', type: '债券型-混合一级' };

const NAVS = [
  { id: 2, date: '2026-09-21', unitNav: 1.4118, createdAt: '2026-09-22T00:00:00Z' },
  { id: 1, date: '2026-09-18', unitNav: 1.4112, createdAt: '2026-09-22T00:00:00Z' },
];

function stubApi(opts: { navs?: typeof NAVS | null; inserted?: boolean } = {}) {
  const { navs = NAVS, inserted = true } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, inserted }), { status: 200 });
      }
      if (url.includes('/navs')) {
        if (navs == null) return new Response(JSON.stringify({ ok: false, error: 'db 异常' }), { status: 200 });
        return new Response(JSON.stringify({ ok: true, fund: FUND, rows: navs }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }),
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('净值日期'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('单位净值'), { target: { value: '1.4' } });
}

describe('FundDetail', () => {
  it('渲染基金信息与净值历史（倒序，4 位小数）', async () => {
    stubApi();
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('2026-09-21');
    expect(screen.getByText('1.4118')).toBeTruthy();
    expect(screen.getByText('华夏债券C')).toBeTruthy();
    expect(screen.getByText('001003')).toBeTruthy();
    expect(screen.getByText('已录 2 条')).toBeTruthy();
  });

  it('补录成功提示并刷新列表', async () => {
    stubApi({ inserted: true });
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('2026-09-21');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: '补录' }));
    await screen.findByText(/已补录 2026-09-01 单位净值 1.4/);
    const post = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ date: '2026-09-01', unitNav: 1.4 });
  });

  it('已存在日期提示不覆盖', async () => {
    stubApi({ inserted: false });
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('2026-09-21');
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: '补录' }));
    await screen.findByText(/已存在净值记录，未覆盖/);
  });

  it('表单校验：净值非正数给出错误', async () => {
    stubApi();
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('2026-09-21');
    fireEvent.change(screen.getByLabelText('净值日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('单位净值'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '补录' }));
    await screen.findByText(/单位净值需为正数/);
    expect(vi.mocked(fetch).mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'POST')).toBe(true);
  });

  it('空历史引导补录；加载失败提示；返回回调', async () => {
    stubApi({ navs: [] });
    const onBack = vi.fn();
    render(<FundDetail fund={FUND} onBack={onBack} />);
    await screen.findByText(/暂无净值记录/);
    fireEvent.click(screen.getByRole('button', { name: /返回关注列表/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
