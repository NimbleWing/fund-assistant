// 基金搜索接口：GET /api/funds/search?q=xxx（实时代理天天基金 suggest，无本地缓存）。
import { json, type Route } from '../../lib/http.ts';
import { searchFunds } from './search.ts';

export const fundsRoutes: Route[] = [
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
];
