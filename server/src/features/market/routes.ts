// market feature 路由：GET /api/market/index（上证指数行情 + 开休市状态）。
// 行情远端失败时仍返回开休市状态（本地时间计算，不依赖远端），index 为 null。
import { json, type Route } from '../../lib/http.ts';
import { fetchIndexQuote } from './quote.ts';
import { isMarketOpen, marketLabel } from './status.ts';

export function marketRoutes(): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/market/index',
      handler: async ({ res }) => {
        const now = new Date();
        const market = { open: isMarketOpen(now), label: marketLabel(now) };
        const quote = await fetchIndexQuote('sh000001');
        if (quote == null) {
          json(res, 200, { ok: false, error: '行情暂不可用（远端请求失败或超时）', index: null, market });
          return;
        }
        json(res, 200, { ok: true, index: { ...quote, name: '上证指数' }, market });
      },
    },
  ];
}
