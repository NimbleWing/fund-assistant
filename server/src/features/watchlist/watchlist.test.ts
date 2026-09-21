// watchlist 单测：store（:memory: 隔离）软删除语义 + 路由集成（真实 HTTP，注入内存 store）。
import type { Server } from 'node:http';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, json, type Route } from '../../lib/http.ts';
import { openWatchStore } from './store.ts';
import { watchlistRoutes } from './routes.ts';

describe('watchlist store', () => {
  it('关注 → 列表；重复关注幂等复活并刷新字段', () => {
    const s = openWatchStore(':memory:');
    expect(s.list()).toEqual([]);
    const r1 = s.add('001003', '华夏债券C', '债券型-混合一级');
    expect(r1).toMatchObject({ code: '001003', name: '华夏债券C', type: '债券型-混合一级' });
    expect(r1.created_at).toBeTruthy();
    // 重复关注：同一 id，name/type 更新，只有一条记录
    const r2 = s.add('001003', '华夏债券C（更名）', null);
    expect(r2.id).toBe(r1.id);
    expect(r2.name).toBe('华夏债券C（更名）');
    expect(r2.type).toBeNull();
    expect(s.list()).toHaveLength(1);
    s.close();
  });

  it('取消关注为软删除：list 不可见，重复取消返回 false，可复活', () => {
    const s = openWatchStore(':memory:');
    s.add('000001', '华夏成长混合', '混合型-灵活');
    expect(s.remove('000001')).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.remove('000001')).toBe(false); // 已软删除，不再重复移除
    expect(s.remove('999999')).toBe(false); // 不存在
    const revived = s.add('000001', '华夏成长混合', '混合型-灵活');
    expect(s.list().map((r) => r.id)).toEqual([revived.id]);
    s.close();
  });
});

describe('watchlist routes', () => {
  let server: Server;
  let base = '';
  const store = openWatchStore(':memory:');

  beforeAll(async () => {
    // 极简分发：直接按 method+path 匹配（复用 app.ts 规则过重，这里只验证 handler 行为）
    const routes: Route[] = watchlistRoutes(store);
    server = http.createServer((req, res) => {
      void (async () => {
        try {
          const u = new URL(req.url ?? '/', 'http://127.0.0.1');
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const ps = r.path.split('/');
            const xs = u.pathname.split('/');
            if (ps.length !== xs.length) continue;
            const params: Record<string, string> = {};
            let ok = true;
            for (let i = 0; i < ps.length; i++) {
              const p = ps[i] as string;
              if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(xs[i] as string);
              else if (p !== xs[i]) { ok = false; break; }
            }
            if (!ok) continue;
            await r.handler({ req, res, url: u, params });
            return;
          }
          json(res, 404, { ok: false, error: 'not found' });
        } catch (e: unknown) {
          if (e instanceof HttpError) json(res, e.code, { ok: false, error: e.message });
          else json(res, 500, { ok: false, error: String(e) });
        }
      })();
    }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    if (addr == null || typeof addr === 'string') throw new Error('无法获取监听端口');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  it('POST 关注 → GET 列表 → DELETE 软删除', async () => {
    const add = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '001003', name: '华夏债券C', type: '债券型-混合一级' }),
    });
    expect(add.status).toBe(200);
    const added = (await add.json()) as { ok: boolean; row: { code: string } };
    expect(added.ok).toBe(true);
    expect(added.row.code).toBe('001003');

    const list = (await (await fetch(`${base}/api/watchlist`)).json()) as { ok: boolean; rows: unknown[] };
    expect(list.rows).toHaveLength(1);

    const del = (await (await fetch(`${base}/api/watchlist/001003`, { method: 'DELETE' })).json()) as { removed: boolean };
    expect(del.removed).toBe(true);
    const list2 = (await (await fetch(`${base}/api/watchlist`)).json()) as { rows: unknown[] };
    expect(list2.rows).toHaveLength(0);
  });

  it('POST 缺 code/name → 400', async () => {
    const res = await fetch(`${base}/api/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '', name: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});
