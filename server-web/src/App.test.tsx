// App 外壳测试：stub fetch 模拟服务 在线/离线，断言状态卡片文案。
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('服务在线：显示在线状态与服务名', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, service: 'fund-server' }), { status: 200 })),
    );
    render(<App />);
    await screen.findByText('服务在线');
    expect(screen.getByText('fund-server')).toBeTruthy();
  });

  it('服务离线：显示离线状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    render(<App />);
    await screen.findByText('服务离线');
  });
});
