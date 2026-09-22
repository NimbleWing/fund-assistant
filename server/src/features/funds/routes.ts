// 基金接口：GET /api/funds/search?q=xxx（实时代理天天基金 suggest，无本地缓存）
//          GET /api/funds/:code/estimate（实时代理 fundgz 盘中估值；code 须在关注列表）。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db。
import { HttpError, json, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from '../watchlist/store.ts';
import { fetchEstimate } from './estimate.ts';
import { searchFunds } from './search.ts';

export function fundsRoutes(stores?: { watch?: WatchStore }): Route[] {
  let lazyWatch: WatchStore | undefined = stores?.watch;
  const watch = (): WatchStore => (lazyWatch ??= openWatchStore());

  return [
    {
      method: 'GET',
      path: '/api/funds/search',
      handler: async ({ res, url }) => {
        const q = url.searchParams.get('q') ?? '';
        const hits = await searchFunds(q);
        if (hits == null) {
          json(res, 200, { ok: false, error: '基金搜索服务暂不可用（远端请求失败或超时）' });
          return;
        }
        json(res, 200, { ok: true, hits });
      },
    },
    {
      method: 'GET',
      path: '/api/funds/:code/estimate',
      handler: async ({ res, params }) => {
        const fund = watch().findByCode(params.code ?? '');
        if (!fund) throw new HttpError(404, '该基金不在关注列表');
        const estimate = await fetchEstimate(fund.code);
        if (estimate == null) {
          json(res, 200, { ok: false, error: '估值暂不可用（远端失败、非交易时段或该基金无盘中估值）' });
          return;
        }
        json(res, 200, { ok: true, estimate });
      },
    },
  ];
}
