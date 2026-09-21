// 目录锚定：src/lib/ → server/。public/ 与后续数据文件（SQLite 库等）均以此为根。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
