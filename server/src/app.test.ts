// 应用集成测试：真实 listen（随机端口）走 HTTP，覆盖路由分发、404 与 Origin 守卫。
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr == null || typeof addr === 'string') throw new Error('无法获取监听端口');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('app 路由与守卫', () => {
  it('GET /api/health → 200 { ok, service }', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'fund-server' });
  });

  it('未知 API 路径 → 404 JSON', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('POST 且 Origin 不被允许 → 403', async () => {
    const res = await fetch(`${base}/api/health`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('POST 且 chrome-extension:// Origin → 守卫放行（无 POST 路由 → 404）', async () => {
    const res = await fetch(`${base}/api/health`, {
      method: 'POST',
      headers: { Origin: 'chrome-extension://abcdef' },
    });
    expect(res.status).toBe(404);
  });
});
