// 临时 feature：解析买卖记录文本并配对分析。数据格式（每行一条，空格分隔）：
//   买入：`时间 本金 确认净值 确认份额`（如 `6-23 1000 4.8223 207.37`）
//   卖出：`- 时间 本金 确认净值 确认份额`（本金=原买入本金，份额与买入一致）
// 配对规则：卖出按出现顺序，与最早的「未配对且确认份额相等」的买入配对（同份额多条时 FIFO）。
// 盈亏 = 份额 × 卖出净值 − 买入本金；未配对买入视为持有中（盈亏 null）。

export interface BuyRecord {
  time: string;
  principal: number;
  nav: number;
  shares: number;
}

export interface SellRecord {
  time: string;
  principal: number;
  nav: number;
  shares: number;
}

export interface PairRow {
  buyTime: string;
  principal: number;
  buyNav: number;
  shares: number;
  sellTime: string | null;
  sellNav: number | null;
  /** 已实现盈亏（份额×卖出净值−买入本金，保留 2 位）；持有中为 null */
  pnl: number | null;
}

export interface RecordsSummary {
  /** 配对行，按买入出现顺序（即文件顺序） */
  rows: PairRow[];
  realizedPnl: number;
  soldPrincipal: number;
  holdingPrincipal: number;
  holdingShares: number;
  /** 找不到份额相等买入的卖出（数据异常） */
  unmatchedSells: SellRecord[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 份额相等判定（浮点安全，容差 1e-6）。 */
function sameShares(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

export function parseRecords(text: string): RecordsSummary {
  const buys: BuyRecord[] = [];
  const sells: SellRecord[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isSell = line.startsWith('-');
    const parts = (isSell ? line.slice(1) : line).trim().split(/\s+/);
    if (parts.length !== 4) continue; // 字段数不对的脏行跳过
    const [time, p, nav, shares] = parts;
    const rec: BuyRecord = { time, principal: Number(p), nav: Number(nav), shares: Number(shares) };
    if (![rec.principal, rec.nav, rec.shares].every(Number.isFinite)) continue; // 非数字跳过
    (isSell ? sells : buys).push(rec);
  }

  const rows: PairRow[] = buys.map((b) => ({
    buyTime: b.time,
    principal: b.principal,
    buyNav: b.nav,
    shares: b.shares,
    sellTime: null,
    sellNav: null,
    pnl: null,
  }));
  const matched = new Set<number>();
  const unmatchedSells: SellRecord[] = [];
  let realizedPnl = 0;
  let soldPrincipal = 0;

  for (const s of sells) {
    let hit = -1;
    for (let i = 0; i < buys.length; i++) {
      if (!matched.has(i) && sameShares(buys[i].shares, s.shares)) {
        hit = i;
        break;
      }
    }
    if (hit === -1) {
      unmatchedSells.push(s);
      continue;
    }
    matched.add(hit);
    const buy = buys[hit];
    const row = rows[hit];
    row.sellTime = s.time;
    row.sellNav = s.nav;
    row.pnl = round2(s.shares * s.nav - buy.principal);
    realizedPnl += row.pnl;
    soldPrincipal += buy.principal;
  }

  let holdingPrincipal = 0;
  let holdingShares = 0;
  for (let i = 0; i < buys.length; i++) {
    if (matched.has(i)) continue;
    holdingPrincipal += buys[i].principal;
    holdingShares += buys[i].shares;
  }

  return {
    rows,
    realizedPnl: round2(realizedPnl),
    soldPrincipal: round2(soldPrincipal),
    holdingPrincipal: round2(holdingPrincipal),
    holdingShares: round2(holdingShares),
    unmatchedSells,
  };
}
