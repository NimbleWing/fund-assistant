// 系统 feature：进程级接口（健康检查）。
import { json, type Route } from '../../lib/http.ts';

export const systemRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: ({ res }) => json(res, 200, { ok: true, service: 'fund-server' }),
  },
];
