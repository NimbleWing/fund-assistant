// 关注基金列表存储：node:sqlite DatabaseSync，库文件 server/fund.db（随仓库提交）。
// 取消关注为软删除（active=0）：后续每日净值任务基于本表派生，硬删除与关联清理留到该任务落地。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { SERVER_ROOT } from '../../lib/paths.ts';

export const DB_FILE = path.resolve(SERVER_ROOT, 'fund.db');

export interface WatchRow {
  id: number;
  code: string;
  name: string;
  type: string | null;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS watchlist(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
)`;

export interface WatchStore {
  list(): WatchRow[];
  /** 按 code 查（含软删除行）；不存在返回 null。 */
  findByCode(code: string): WatchRow | null;
  /** 关注（重复关注幂等：复活软删除并刷新 name/type/updated_at）。返回该 code 的当前行。 */
  add(code: string, name: string, type: string | null): WatchRow;
  /** 软删除；返回是否有活跃行被移除。 */
  remove(code: string): boolean;
  close(): void;
}

function now(): string {
  return new Date().toISOString();
}

/** 打开（必要时创建）库并保证 schema；dbPath 传 ':memory:' 供测试隔离。 */
export function openWatchStore(dbPath: string = DB_FILE): WatchStore {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const stmtList = db.prepare('SELECT id, code, name, type, created_at, updated_at FROM watchlist WHERE active = 1 ORDER BY id');
  const stmtUpsert = db.prepare(`
    INSERT INTO watchlist(code, name, type, created_at, updated_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = excluded.updated_at, active = 1
  `);
  const stmtGet = db.prepare('SELECT id, code, name, type, created_at, updated_at FROM watchlist WHERE code = ?');
  const stmtRemove = db.prepare('UPDATE watchlist SET active = 0, updated_at = ? WHERE code = ? AND active = 1');

  return {
    list: () => stmtList.all() as unknown as WatchRow[],
    findByCode: (code) => (stmtGet.get(code) as unknown as WatchRow) ?? null,
    add(code, name, type) {
      const ts = now();
      stmtUpsert.run(code, name, type, ts, ts);
      return stmtGet.get(code) as unknown as WatchRow;
    },
    remove: (code) => Number(stmtRemove.run(now(), code).changes) > 0,
    close: () => db.close(),
  };
}
