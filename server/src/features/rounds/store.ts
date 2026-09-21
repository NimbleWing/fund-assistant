// 轮次存储：fund.db 内 round / round_txn 两表（见 DESIGN.md §11）。
// 清仓快照由 routes 层调 calcRound 重算后经 closeRound 写入，store 不做计算。
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE } from '../watchlist/store.ts';

export type RoundStatus = 'active' | 'closed';
export type TxnDirection = 'buy' | 'sell';

export interface RoundRow {
  id: number;
  fundCode: string;
  seq: number;
  status: RoundStatus;
  buyCount: number | null;
  sellCount: number | null;
  invested: number | null;
  proceeds: number | null;
  realizedPnl: number | null;
  soldPrincipal: number | null;
  totalPnl: number | null;
  createdAt: string;
  closedAt: string | null;
}

export interface TxnRow {
  id: number;
  roundId: number;
  direction: TxnDirection;
  date: string;
  amount: number;
  nav: number;
  shares: number;
  /** 手续费（仅卖出有意义，买入为 0） */
  fee: number;
  /** 显式配对的买入交易 id（仅卖出有意义；null = 自动 FIFO） */
  pairBuyId: number | null;
  createdAt: string;
}

export interface CloseSnapshot {
  buyCount: number;
  sellCount: number;
  invested: number;
  proceeds: number;
  realizedPnl: number;
  soldPrincipal: number;
  totalPnl: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS round(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_code      TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  buy_count      INTEGER,
  sell_count     INTEGER,
  invested       REAL,
  proceeds       REAL,
  realized_pnl   REAL,
  sold_principal REAL,
  total_pnl      REAL,
  created_at     TEXT NOT NULL,
  closed_at      TEXT,
  UNIQUE(fund_code, seq)
);
CREATE TABLE IF NOT EXISTS round_txn(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL,
  direction  TEXT NOT NULL,
  date       TEXT NOT NULL,
  amount     REAL NOT NULL,
  nav        REAL NOT NULL,
  shares     REAL NOT NULL,
  fee        REAL NOT NULL DEFAULT 0,
  pair_buy_id INTEGER,
  created_at TEXT NOT NULL
)`;

const COLS = 'id, fund_code AS fundCode, seq, status, buy_count AS buyCount, sell_count AS sellCount, invested, proceeds, realized_pnl AS realizedPnl, sold_principal AS soldPrincipal, total_pnl AS totalPnl, created_at AS createdAt, closed_at AS closedAt';
const TXN_COLS = 'id, round_id AS roundId, direction, date, amount, nav, shares, fee, pair_buy_id AS pairBuyId, created_at AS createdAt';

export interface RoundsStore {
  listRounds(fundCode: string): RoundRow[];
  getRound(id: number): RoundRow | null;
  /** 该基金当前进行中轮；无则 null。 */
  activeRound(fundCode: string): RoundRow | null;
  /** 开轮：seq = 该基金现有最大 seq + 1。 */
  createRound(fundCode: string): RoundRow;
  listTxns(roundId: number): TxnRow[];
  addTxn(roundId: number, txn: { direction: TxnDirection; date: string; amount: number; nav: number; shares: number; fee?: number; pairBuyId?: number | null }): TxnRow;
  /** 删除一条交易；返回是否有行被删。 */
  deleteTxn(roundId: number, txnId: number): boolean;
  /** 闭轮：写入快照 + closed_at，状态置 closed。 */
  closeRound(id: number, snapshot: CloseSnapshot): void;
  close(): void;
}

/** 打开（必要时创建）库并保证 round/round_txn schema；dbPath 传 ':memory:' 供测试隔离。 */
export function openRoundsStore(dbPath: string = DB_FILE): RoundsStore {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  // 存量库迁移：round_txn 缺 fee / pair_buy_id 列时补上
  const txnCols = db.prepare("SELECT name FROM pragma_table_info('round_txn')").all() as unknown as { name: string }[];
  if (!txnCols.some((c) => c.name === 'fee')) {
    db.exec('ALTER TABLE round_txn ADD COLUMN fee REAL NOT NULL DEFAULT 0');
  }
  if (!txnCols.some((c) => c.name === 'pair_buy_id')) {
    db.exec('ALTER TABLE round_txn ADD COLUMN pair_buy_id INTEGER');
  }

  const stmtList = db.prepare(`SELECT ${COLS} FROM round WHERE fund_code = ? ORDER BY seq`);
  const stmtGet = db.prepare(`SELECT ${COLS} FROM round WHERE id = ?`);
  const stmtActive = db.prepare(`SELECT ${COLS} FROM round WHERE fund_code = ? AND status = 'active' LIMIT 1`);
  const stmtMaxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM round WHERE fund_code = ?');
  const stmtCreate = db.prepare(`INSERT INTO round(fund_code, seq, status, created_at) VALUES (?, ?, 'active', ?)`);
  const stmtTxns = db.prepare(`SELECT ${TXN_COLS} FROM round_txn WHERE round_id = ? ORDER BY id`);
  const stmtAddTxn = db.prepare('INSERT INTO round_txn(round_id, direction, date, amount, nav, shares, fee, pair_buy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const stmtGetTxn = db.prepare(`SELECT ${TXN_COLS} FROM round_txn WHERE id = ?`);
  const stmtDelTxn = db.prepare('DELETE FROM round_txn WHERE id = ? AND round_id = ?');
  const stmtClose = db.prepare(`
    UPDATE round SET status = 'closed', buy_count = ?, sell_count = ?, invested = ?, proceeds = ?,
      realized_pnl = ?, sold_principal = ?, total_pnl = ?, closed_at = ?
    WHERE id = ? AND status = 'active'
  `);

  return {
    listRounds: (fundCode) => stmtList.all(fundCode) as unknown as RoundRow[],
    getRound: (id) => (stmtGet.get(id) as unknown as RoundRow) ?? null,
    activeRound: (fundCode) => (stmtActive.get(fundCode) as unknown as RoundRow) ?? null,
    createRound(fundCode) {
      const { maxSeq } = stmtMaxSeq.get(fundCode) as unknown as { maxSeq: number };
      const id = Number(stmtCreate.run(fundCode, maxSeq + 1, new Date().toISOString()).lastInsertRowid);
      return stmtGet.get(id) as unknown as RoundRow;
    },
    listTxns: (roundId) => stmtTxns.all(roundId) as unknown as TxnRow[],
    addTxn(roundId, txn) {
      const id = Number(stmtAddTxn.run(roundId, txn.direction, txn.date, txn.amount, txn.nav, txn.shares, txn.fee ?? 0, txn.pairBuyId ?? null, new Date().toISOString()).lastInsertRowid);
      return stmtGetTxn.get(id) as unknown as TxnRow;
    },
    deleteTxn: (roundId, txnId) => Number(stmtDelTxn.run(txnId, roundId).changes) > 0,
    closeRound(id, s) {
      stmtClose.run(s.buyCount, s.sellCount, s.invested, s.proceeds, s.realizedPnl, s.soldPrincipal, s.totalPnl, new Date().toISOString(), id);
    },
    close: () => db.close(),
  };
}
