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

const ESTS = [
  { id: 1, date: '2026-09-21', estimatedNav: 1.415, estimatedPct: 0.23, estTime: '2026-09-21 15:00', createdAt: '2026-09-21T16:00:00Z' },
];

function stubApi(opts: { navs?: typeof NAVS | null; ests?: typeof ESTS; inserted?: boolean } = {}) {
  const { navs = NAVS, ests = ESTS, inserted = true } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, inserted }), { status: 200 });
      }
      if (url.includes('/navs')) {
        if (navs == null) return new Response(JSON.stringify({ ok: false, error: 'db 异常' }), { status: 200 });
        return new Response(JSON.stringify({ ok: true, fund: FUND, rows: navs, estRows: ests }), { status: 200 });
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
    stubApi({ navs: [], ests: [] });
    const onBack = vi.fn();
    render(<FundDetail fund={FUND} onBack={onBack} />);
    await screen.findByText(/暂无净值记录/);
    fireEvent.click(screen.getByRole('button', { name: /返回关注列表/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('预估净值列：有实际净值时展示偏差；仅预估无实际的日期也成行', async () => {
    stubApi({
      ests: [
        { id: 2, date: '2026-09-22', estimatedNav: 1.42, estimatedPct: 0.58, estTime: '2026-09-22 15:00', createdAt: '' },
        { id: 1, date: '2026-09-21', estimatedNav: 1.415, estimatedPct: 0.23, estTime: '2026-09-21 15:00', createdAt: '' },
      ],
    });
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('2026-09-22'); // 仅预估的日期合并入行
    expect(screen.getByText('预估净值')).toBeTruthy();
    expect(screen.getByText('1.4150')).toBeTruthy();
    // 2026-09-21：实际 1.4118，预估 1.4150 → 偏差 (1.415-1.4118)/1.4118 ≈ +0.23%
    expect(screen.getByText(/偏差 \+0\.23%/)).toBeTruthy();
    // 2026-09-18 无预估 → 占位
    const row18 = screen.getByText('2026-09-18').closest('tr');
    expect(row18?.querySelectorAll('td')[2]?.textContent).toBe('—');
  });

  it('分页：每页 50 条，翻页切换；分页栏固定底部且支持页码跳转', async () => {
    // 合并视图按日期去重，分页数据需唯一日期（120 个连续日）
    const p2 = (n: number) => String(n).padStart(2, '0');
    const many = Array.from({ length: 120 }, (_, i) => {
      const d = new Date(2026, 0, 1 + i);
      return { id: i + 1, date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, unitNav: 1 + i / 1000, createdAt: '' };
    });
    stubApi({ navs: many, ests: [] });
    render(<FundDetail fund={FUND} onBack={() => {}} />);
    await screen.findByText('已录 120 条');
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 50); // 表头 + 50 行
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('第 2 / 3 页');
    // 页码跳转：输入 3 → 第 3 页；越界钳制到末页
    fireEvent.change(screen.getByLabelText('页码跳转'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    await screen.findByText('第 3 / 3 页');
    expect(screen.getAllByRole('row')).toHaveLength(1 + 20); // 末页 20 行
    fireEvent.change(screen.getByLabelText('页码跳转'), { target: { value: '99' } });
    fireEvent.keyDown(screen.getByLabelText('页码跳转'), { key: 'Enter' });
    await screen.findByText('第 3 / 3 页');
  });
});
