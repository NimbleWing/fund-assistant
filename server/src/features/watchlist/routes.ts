// 关注基金列表接口：GET 列表（附最新净值日期/净值 + 期望净值日期，供面板展示今日净值更新状态）/ POST 关注（幂等复活 + 自动写入全量净值历史）/ DELETE 软删除。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db（避免测试导入 app.ts 时误建库文件）。
import { asRecord, HttpError, json, readJson, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from './store.ts';
import { openNavStore, type NavStore } from '../nav/store.ts';
import { expectedLatestNavDate, syncFundNav } from '../nav/sync.ts';
import type { FetchLike } from '../funds/search.ts';

interface Stores {
  watch?: WatchStore;
  nav?: NavStore;
  fetchImpl?: FetchLike;
}

export function watchlistRoutes(stores?: Stores): Route[] {
  let lazyWatch: WatchStore | undefined = stores?.watch;
  let lazyNav: NavStore | undefined = stores?.nav;
  const watch = (): WatchStore => (lazyWatch ??= openWatchStore());
  const nav = (): NavStore => (lazyNav ??= openNavStore());

  return [
    {
      method: 'GET',
      path: '/api/watchlist',
      handler: ({ res }) => {
        const w = watch();
        const n = nav();
        // 每行附最新净值（日期+单位净值），顶层附期望净值日期（20:00 前上一交易日、周末回退周五、节假日不识别）
        const rows = w.list().map((r) => {
          const latest = n.latestByFund(r.id);
          return { ...r, latestNavDate: latest?.date ?? null, latestUnitNav: latest?.unitNav ?? null };
        });
        json(res, 200, { ok: true, rows, expectedNavDate: expectedLatestNavDate(new Date()) });
      },
    },
    {
      method: 'POST',
      path: '/api/watchlist',
      handler: async ({ req, res }) => {
        const body = asRecord(await readJson(req));
        const code = typeof body?.code === 'string' ? body.code.trim() : '';
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!code || !name) throw new HttpError(400, 'code 与 name 不能为空');
        const type = typeof body?.type === 'string' && body.type.trim() ? body.type.trim() : null;
        const row = watch().add(code, name, type);
        // 关注即写入全量净值历史；失败不阻塞关注本身（navSynced 为 null，前端可提示）
        const navSynced = await syncFundNav(row, nav(), stores?.fetchImpl ?? fetch);
        json(res, 200, { ok: true, row, navSynced });
      },
    },
    {
      method: 'DELETE',
      path: '/api/watchlist/:code',
      handler: ({ res, params }) => {
        const removed = watch().remove(params.code ?? '');
        json(res, 200, { ok: true, removed });
      },
    },
  ];
}
