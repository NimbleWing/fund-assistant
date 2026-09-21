// 心跳探测单测：注入 fetch 模拟 在线（200）/ 离线（网络错误、非 200）三类路径。
import { describe, expect, it, vi } from 'vitest';
import { checkHealth } from '../../src/core/health.ts';

describe('checkHealth', () => {
  it('在线：返回时延与 service', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, service: 'fund-server' }), { status: 200 }));
    const r = await checkHealth(fetchMock as unknown as typeof fetch);
    expect(r.online).toBe(true);
    expect(r.service).toBe('fund-server');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('离线：网络错误（服务未启动）', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const r = await checkHealth(fetchMock as unknown as typeof fetch);
    expect(r.online).toBe(false);
  });

  it('离线：非 200 响应', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    const r = await checkHealth(fetchMock as unknown as typeof fetch);
    expect(r.online).toBe(false);
  });
});
