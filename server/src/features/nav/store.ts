// 基金净值历史存储：fund.db 内 fund_nav 表（与 watchlist 同库，watchlist_id 关联）。
// 去重靠 UNIQUE(watchlist_id, date) + INSERT OR IGNORE——自动同步与手动补录同一规则：已存在不覆盖。
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE } from '../watchlist/store.ts';

export interface NavRow {
  id: number;
  /** 净值日期 YYYY-MM-DD */
  date: string;
  /** 单位净值 */
  unitNav: number;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fund_nav(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL,   -- 逻辑关联 watchlist.id（不启用 FK 约束：prepare 时 SQLite 会校验被引用表存在，跨连接顺序敏感）
  unit_nav     REAL NOT NULL,
  date         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(watchlist_id, date)
)`;

export interface NavStore {
  /** 该基金全部净值，date 倒序。 */
  listByFund(watchlistId: number): NavRow[];
  /** 插入一条；该日期已存在时不覆盖，返回 false。 */
  insertIgnore(watchlistId: number, date: string, unitNav: number): boolean;
  /** 该基金某日净值是否已入库。 */
  hasDate(watchlistId: number, date: string): boolean;
  /** 该基金最新一条净值；无记录为 null。 */
  latestByFund(watchlistId: number): NavRow | null;
  close(): void;
}

/** 打开（必要时创建）库并保证 fund_nav schema；dbPath 传 ':memory:' 供测试隔离。 */
export function openNavStore(dbPath: string = DB_FILE): NavStore {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const stmtList = db.prepare('SELECT id, date, unit_nav AS unitNav, created_at AS createdAt FROM fund_nav WHERE watchlist_id = ? ORDER BY date DESC');
  const stmtInsert = db.prepare('INSERT OR IGNORE INTO fund_nav(watchlist_id, unit_nav, date, created_at) VALUES (?, ?, ?, ?)');
  const stmtHas = db.prepare('SELECT 1 FROM fund_nav WHERE watchlist_id = ? AND date = ? LIMIT 1');
  const stmtLatest = db.prepare('SELECT id, date, unit_nav AS unitNav, created_at AS createdAt FROM fund_nav WHERE watchlist_id = ? ORDER BY date DESC LIMIT 1');

  return {
    listByFund: (watchlistId) => stmtList.all(watchlistId) as unknown as NavRow[],
    insertIgnore: (watchlistId, date, unitNav) =>
      Number(stmtInsert.run(watchlistId, unitNav, date, new Date().toISOString()).changes) > 0,
    hasDate: (watchlistId, date) => stmtHas.get(watchlistId, date) != null,
    latestByFund: (watchlistId) => (stmtLatest.get(watchlistId) as unknown as NavRow) ?? null,
    close: () => db.close(),
  };
}
