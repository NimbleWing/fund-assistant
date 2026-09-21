// 关注基金列表接口：GET 列表 / POST 关注（幂等复活）/ DELETE 软删除。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db（避免测试导入 app.ts 时误建库文件）。
import { asRecord, HttpError, json, readJson, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from './store.ts';

export function watchlistRoutes(store?: WatchStore): Route[] {
  let lazy: WatchStore | undefined = store;
  const db = (): WatchStore => (lazy ??= openWatchStore());

  return [
    {
      method: 'GET',
      path: '/api/watchlist',
      handler: ({ res }) => {
        json(res, 200, { ok: true, rows: db().list() });
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
        json(res, 200, { ok: true, row: db().add(code, name, type) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/watchlist/:code',
      handler: ({ res, params }) => {
        const removed = db().remove(params.code ?? '');
        json(res, 200, { ok: true, removed });
      },
    },
  ];
}
