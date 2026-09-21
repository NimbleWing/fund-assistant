// 基金净值历史接口：GET 历史列表 / POST 手动补录。
// 手动补录与启动同步同一去重规则（已存在不覆盖），但补录对已存在日期返回 inserted:false 由前端提示。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db。
import { asRecord, HttpError, json, readJson, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from './store.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function navRoutes(stores?: { watch?: WatchStore; nav?: NavStore }): Route[] {
  let lazyWatch: WatchStore | undefined = stores?.watch;
  let lazyNav: NavStore | undefined = stores?.nav;
  const watch = (): WatchStore => (lazyWatch ??= openWatchStore());
  const nav = (): NavStore => (lazyNav ??= openNavStore());

  return [
    {
      method: 'GET',
      path: '/api/funds/:code/navs',
      handler: ({ res, params }) => {
        const fund = watch().findByCode(params.code ?? '');
        if (!fund) throw new HttpError(404, '该基金不在关注列表');
        json(res, 200, { ok: true, fund: { code: fund.code, name: fund.name, type: fund.type }, rows: nav().listByFund(fund.id) });
      },
    },
    {
      method: 'POST',
      path: '/api/funds/:code/nav',
      handler: async ({ req, res, params }) => {
        const fund = watch().findByCode(params.code ?? '');
        if (!fund) throw new HttpError(404, '该基金不在关注列表，请先关注再补录净值');
        const body = asRecord(await readJson(req));
        const date = typeof body?.date === 'string' ? body.date.trim() : '';
        const unitNav = Number(body?.unitNav);
        if (!DATE_RE.test(date)) throw new HttpError(400, 'date 需为 YYYY-MM-DD 格式');
        if (!Number.isFinite(unitNav) || unitNav <= 0) throw new HttpError(400, 'unitNav 需为正数');
        const inserted = nav().insertIgnore(fund.id, date, unitNav);
        json(res, 200, { ok: true, inserted });
      },
    },
  ];
}
