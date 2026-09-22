// nav feature 单测：store 去重、lsjz 归一化（领域术语映射）、启动同步编排、路由（补录提示）。
import type { Server } from 'node:http';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpError, json, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from './store.ts';
import { normalizeLsjz, normalizeNetWorthTrend } from './fetch.ts';
import { expectedLatestNavDate, startNavSync } from './sync.ts';
import { startEstNavSync } from './estimate-sync.ts';
import { navRoutes } from './routes.ts';

const LSJZ_BODY = {
  ErrCode: 0,
  Data: {
    LSJZList: [
      { FSRQ: '2026-09-21', DWJZ: '1.4118', JZZZL: '0.04' },
      { FSRQ: '2026-09-18', DWJZ: '1.4112' },
      { FSRQ: '脏行', DWJZ: null },
      { FSRQ: '2026-09-17', DWJZ: '0' },
    ],
  },
};

function stubFetch(body: unknown = LSJZ_BODY, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body, text: async () => String(body) }));
}

describe('nav store', () => {
  it('insertIgnore 去重：重复日期不覆盖', () => {
    const s = openNavStore(':memory:');
    expect(s.insertIgnore(1, '2026-09-21', 1.4118)).toBe(true);
    expect(s.insertIgnore(1, '2026-09-21', 9.9999)).toBe(false);
    expect(s.insertIgnore(1, '2026-09-18', 1.4112)).toBe(true);
    expect(s.listByFund(1).map((r) => `${r.date}@${r.unitNav}`)).toEqual(['2026-09-21@1.4118', '2026-09-18@1.4112']);
    expect(s.listByFund(2)).toEqual([]);
    s.close();
  });

  it('预估净值：insertEstIgnore 固化不覆盖，listEstByFund 按 date 倒序', () => {
    const s = openNavStore(':memory:');
    expect(s.insertEstIgnore(1, '2026-09-21', 1.415, 0.35, '2026-09-21 15:00')).toBe(true);
    expect(s.insertEstIgnore(1, '2026-09-21', 9.9, 9.9, '2026-09-21 15:00')).toBe(false); // 已固化不覆盖
    expect(s.insertEstIgnore(1, '2026-09-22', 1.42, 0.5, '2026-09-22 15:00')).toBe(true);
    expect(s.hasEstDate(1, '2026-09-21')).toBe(true);
    expect(s.hasEstDate(1, '2026-09-23')).toBe(false);
    expect(s.listEstByFund(1).map((r) => `${r.date}@${r.estimatedNav}/${r.estimatedPct}`)).toEqual(['2026-09-22@1.42/0.5', '2026-09-21@1.415/0.35']);
    expect(s.listEstByFund(2)).toEqual([]);
    s.close();
  });
});

describe('normalizeLsjz', () => {
  it('FSRQ→date、DWJZ→unitNav，脏行跳过', () => {
    expect(normalizeLsjz(LSJZ_BODY)).toEqual([
      { date: '2026-09-21', unitNav: 1.4118 },
      { date: '2026-09-18', unitNav: 1.4112 },
    ]);
  });

  it('非法结构返回空列表', () => {
    expect(normalizeLsjz(null)).toEqual([]);
    expect(normalizeLsjz({})).toEqual([]);
    expect(normalizeLsjz({ Data: {} })).toEqual([]);
  });
});

describe('normalizeNetWorthTrend', () => {
  it('x（北京时间零点毫秒）→date、y→unitNav；时区无关', () => {
    const text = 'var Data_netWorthTrend = [{"x":1789833600000,"y":3.68,"equityReturn":0.5},{"x":1789920000000,"y":3.722}];';
    expect(normalizeNetWorthTrend(text)).toEqual([
      { date: '2026-09-20', unitNav: 3.68 },
      { date: '2026-09-21', unitNav: 3.722 },
    ]);
  });

  it('提取失败/非法 JSON/脏行跳过', () => {
    expect(normalizeNetWorthTrend('')).toEqual([]);
    expect(normalizeNetWorthTrend('var Data_netWorthTrend = [非法];')).toEqual([]);
    expect(normalizeNetWorthTrend('var Data_netWorthTrend = [{"x":0,"y":1},{"x":1789920000000,"y":0},{"x":1789920000000,"y":3.722}];')).toEqual([
      { date: '2026-09-21', unitNav: 3.722 },
    ]);
  });
});

describe('expectedLatestNavDate', () => {
  // 2026-09-21 为周一，09-22 周二，09-18 周五，09-19/20 周末
  it('20:00 前期望上一交易日；20:00 后期望当日；周末回退到最近周五', () => {
    expect(expectedLatestNavDate(new Date('2026-09-22T10:00:00'))).toBe('2026-09-21'); // 周二早 → 周一
    expect(expectedLatestNavDate(new Date('2026-09-21T10:00:00'))).toBe('2026-09-18'); // 周一早 → 周五
    expect(expectedLatestNavDate(new Date('2026-09-19T10:00:00'))).toBe('2026-09-18'); // 周六早 → 周五
    expect(expectedLatestNavDate(new Date('2026-09-22T21:00:00'))).toBe('2026-09-22'); // 周二晚 → 当日
    expect(expectedLatestNavDate(new Date('2026-09-20T21:00:00'))).toBe('2026-09-18'); // 周日晚 → 周五
  });
});

describe('startNavSync', () => {
  function openPair(): { watch: WatchStore; nav: NavStore } {
    // 两个独立内存库连接（SQLite 内存库不可跨连接共享）；FK 未启用，跨库 watchlist_id 不影响测试
    const watch = openWatchStore(':memory:');
    return { watch, nav: openNavStore(':memory:') };
  }

  const BODY_WITH_TODAY = {
    Data: {
      LSJZList: [
        { FSRQ: '2026-09-22', DWJZ: '1.42' },
        { FSRQ: '2026-09-21', DWJZ: '1.4118' },
      ],
    },
  };

  it('20:00 前：期望日期已入库则不抓取', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    nav.insertIgnore(fund.id, '2026-09-21', 1.4118);
    const fetchImpl = stubFetch();
    const ctrl = startNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T10:00:00'), log: () => {} });
    await ctrl.done;
    expect(fetchImpl).not.toHaveBeenCalled();
    watch.close();
    nav.close();
  });

  it('20:00 前：期望日期缺失只抓一次，不启动轮询', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    const fetchImpl = stubFetch();
    const ctrl = startNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T10:00:00'), retryIntervalMs: 10, log: () => {} });
    await ctrl.done;
    expect(nav.hasDate(fund.id, '2026-09-21')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 无轮询
    watch.close();
    nav.close();
  });

  it('20:00 后：当日未公布则每小时轮询，入库后停止', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    let published = false;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => (published ? BODY_WITH_TODAY : LSJZ_BODY),
      text: async () => '',
    }));
    const ctrl = startNavSync({
      watchStore: watch,
      navStore: nav,
      fetchImpl,
      now: () => new Date('2026-09-22T21:00:00'),
      retryIntervalMs: 20,
      log: () => {},
    });
    await ctrl.done;
    expect(nav.hasDate(fund.id, '2026-09-22')).toBe(false); // 首轮未公布
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2)); // 轮询中
    published = true; // 模拟净值公布
    await vi.waitFor(() => expect(nav.hasDate(fund.id, '2026-09-22')).toBe(true)); // 入库
    await new Promise((r) => setTimeout(r, 80)); // 等轮询停止生效
    const calls = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50)); // 跨过 ≥2 个轮询周期
    expect(fetchImpl.mock.calls.length).toBe(calls); // 已停止
    ctrl.stop();
    watch.close();
    nav.close();
  });
});

describe('startEstNavSync', () => {
  function openPair(): { watch: WatchStore; nav: NavStore } {
    const watch = openWatchStore(':memory:');
    return { watch, nav: openNavStore(':memory:') };
  }

  // 2026-09-22 为周二；新浪 fu_ 串字段位见 estimate.ts
  const EST_TEXT = 'var hq_str_fu_001003="华夏债券C,15:00:00,1.4150,1.4100,0,0,0.35,2026-09-22";';
  const estFetch = (text: string, ok = true) => vi.fn(async () => ({ ok, text: async () => text, json: async () => ({}) }));

  it('固化窗口外（工作日 16:00 前 / 周末）不抓取', async () => {
    const { watch, nav } = openPair();
    watch.add('001003', '华夏债券C', null);
    const fetchImpl = estFetch(EST_TEXT);
    const ctrl = startEstNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T10:00:00'), tickMs: 15, log: () => {} });
    await ctrl.done;
    await new Promise((r) => setTimeout(r, 50)); // 跨过数个 tick
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(nav.hasEstDate(1, '2026-09-22')).toBe(false);
    ctrl.stop();
    watch.close();
    nav.close();
  });

  it('16:00 后固化当日估值（以估值自带日期落库），已固化基金不再抓取', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    const fetchImpl = estFetch(EST_TEXT);
    const ctrl = startEstNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T16:05:00'), tickMs: 15, log: () => {} });
    await ctrl.done;
    expect(nav.hasEstDate(fund.id, '2026-09-22')).toBe(true);
    expect(nav.listEstByFund(fund.id)[0]).toMatchObject({ date: '2026-09-22', estimatedNav: 1.415, estimatedPct: 0.35, estTime: '2026-09-22 15:00' });
    await new Promise((r) => setTimeout(r, 50)); // 当日已收工，后续 tick 空转
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    ctrl.stop();
    watch.close();
    nav.close();
  });

  it('抓取失败下一周期重试；无估值（QDII 等）当日跳过不重试', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    watch.add('519736', '交银新成长', null); // 模拟无估值基金（空估值串）
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      const url = String((fetchImpl.mock.calls.at(-1) as unknown[])[0]);
      if (url.includes('519736')) return { ok: true, text: async () => 'var hq_str_fu_519736="";', json: async () => ({}) };
      return calls === 1 ? { ok: false, text: async () => '', json: async () => ({}) } : { ok: true, text: async () => EST_TEXT, json: async () => ({}) };
    });
    const ctrl = startEstNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T16:05:00'), tickMs: 15, log: () => {} });
    await ctrl.done;
    expect(nav.hasEstDate(fund.id, '2026-09-22')).toBe(false); // 首轮 001003 失败未固化
    await vi.waitFor(() => expect(nav.hasEstDate(fund.id, '2026-09-22')).toBe(true)); // 次轮重试成功
    await new Promise((r) => setTimeout(r, 60)); // 两基金均处理完毕后 tick 空转
    const total = fetchImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(fetchImpl.mock.calls.length).toBe(total); // 无估值基金也未被反复抓取
    ctrl.stop();
    watch.close();
    nav.close();
  });

  it('节假日：估值自带日期非当日，按估值日落库并当日收工', async () => {
    const { watch, nav } = openPair();
    const fund = watch.add('001003', '华夏债券C', null);
    const staleText = 'var hq_str_fu_001003="华夏债券C,15:00:00,1.41,1.4,0,0,0.71,2026-09-21";';
    const fetchImpl = estFetch(staleText);
    const ctrl = startEstNavSync({ watchStore: watch, navStore: nav, fetchImpl, now: () => new Date('2026-09-22T16:05:00'), tickMs: 15, log: () => {} });
    await ctrl.done;
    expect(nav.hasEstDate(fund.id, '2026-09-21')).toBe(true); // 补固化上一交易日
    expect(nav.hasEstDate(fund.id, '2026-09-22')).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 当日收工
    ctrl.stop();
    watch.close();
    nav.close();
  });
});

describe('nav routes', () => {  let server: Server;
  let base = '';
  const watch = openWatchStore(':memory:');
  const nav = openNavStore(':memory:');
  watch.add('001003', '华夏债券C', '债券型-混合一级');

  beforeAll(async () => {
    const routes: Route[] = navRoutes({ watch, nav });
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
    watch.close();
    nav.close();
  });

  it('POST 补录 → GET 历史；重复日期返回 inserted:false 且不覆盖', async () => {
    const post = async (date: string, unitNav: number) =>
      (await (
        await fetch(`${base}/api/funds/001003/nav`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, unitNav }),
        })
      ).json()) as { ok: boolean; inserted: boolean };

    expect((await post('2026-09-01', 1.4)).inserted).toBe(true);
    expect((await post('2026-09-01', 9.9)).inserted).toBe(false); // 已存在不覆盖

    const list = (await (await fetch(`${base}/api/funds/001003/navs`)).json()) as {
      ok: boolean;
      fund: { code: string; name: string };
      rows: { date: string; unitNav: number }[];
    };
    expect(list.fund).toMatchObject({ code: '001003', name: '华夏债券C' });
    expect(list.rows).toEqual([{ id: expect.any(Number), date: '2026-09-01', unitNav: 1.4, createdAt: expect.any(String) }]);
  });

  it('GET 历史返回 estRows（固化预估净值，date 倒序）', async () => {
    const fund = watch.findByCode('001003');
    nav.insertEstIgnore(fund!.id, '2026-09-01', 1.405, 0.36, '2026-09-01 15:00');
    nav.insertEstIgnore(fund!.id, '2026-09-02', 1.412, 0.5, '2026-09-02 15:00');
    const list = (await (await fetch(`${base}/api/funds/001003/navs`)).json()) as {
      ok: boolean;
      estRows: { date: string; estimatedNav: number; estimatedPct: number; estTime: string }[];
    };
    expect(list.estRows.map((r) => `${r.date}@${r.estimatedNav}`)).toEqual(['2026-09-02@1.412', '2026-09-01@1.405']);
    expect(list.estRows[0]).toMatchObject({ estimatedPct: 0.5, estTime: '2026-09-02 15:00' });
  });

  it('校验：非法日期 / 非正数净值 / 未关注基金', async () => {
    const post = (code: string, body: unknown) =>
      fetch(`${base}/api/funds/${code}/nav`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('001003', { date: '09-01', unitNav: 1.4 })).status).toBe(400);
    expect((await post('001003', { date: '2026-09-01', unitNav: -1 })).status).toBe(400);
    expect((await post('999999', { date: '2026-09-01', unitNav: 1.4 })).status).toBe(404);
    expect((await (await fetch(`${base}/api/funds/999999/navs`)).status)).toBe(404);
  });
});
