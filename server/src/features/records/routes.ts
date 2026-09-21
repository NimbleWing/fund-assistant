// 临时 feature：买卖记录分析接口。数据源为仓库根目录 buyAndSellRecord.txt（手动维护），
// 文件缺失时返回 ok:false（不抛错，前端给出提示）。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { json, type Route } from '../../lib/http.ts';
import { SERVER_ROOT } from '../../lib/paths.ts';
import { parseRecords } from './parse.ts';

const RECORDS_FILE = path.resolve(SERVER_ROOT, '..', 'buyAndSellRecord.txt');

export const recordsRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/records',
    handler: async ({ res }) => {
      let text: string;
      try {
        text = await fs.readFile(RECORDS_FILE, 'utf8');
      } catch {
        json(res, 200, { ok: false, error: `未找到记录文件（${RECORDS_FILE}）` });
        return;
      }
      json(res, 200, { ok: true, ...parseRecords(text) });
    },
  },
];
