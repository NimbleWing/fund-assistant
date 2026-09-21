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
  /** 买入行份额与 本金÷净值 偏差超 1% 的疑似录入错误（时间/本金/净值/份额/推算份额） */
  anomalies: Anomaly[];
  /** 摊薄成本口径（对齐基金 App 的「持仓收益」） */
  diluted: DilutedSummary;
  /** 全部买入本金合计 */
  totalBuyPrincipal: number;
  /** 全部卖出回款合计（份额×卖出净值） */
  sellProceeds: number;
  /** 账户回本净值（(总买入−总回款)÷持仓份额，总盈亏归零所需净值）；无持仓为 null */
  accountBreakEvenNav: number | null;
  /** 最后一条卖出的确认净值（供前端默认「最新净值」）；无卖出为 null */
  latestSellNav: number | null;
  /** 逐笔回放序列（按文件顺序，含每步后的摊薄状态快照） */
  timeline: TimelineStep[];
}

export interface Anomaly {
  time: string;
  principal: number;
  nav: number;
  shares: number;
  /** 按 本金÷净值 推算的份额（保留 2 位） */
  expectedShares: number;
}

/** 摊薄成本口径（对齐基金 App）：买入累加成本；卖出按当时平均成本价扣减，已实现盈亏滚入剩余持仓成本。 */
export interface DilutedSummary {
  /** 摊薄持仓成本 */
  cost: number;
  /** 摊薄成本价（成本÷当前份额，4 位）；无持仓为 null */
  costPrice: number | null;
  /** 摊薄口径已实现盈亏（回款 − 累计扣减成本） */
  realizedPnl: number;
}

/** 回放单步：一笔交易明细 + 该步之后的摊薄口径状态快照（过程回放页签数据源）。 */
export interface TimelineStep {
  /** 第几笔（1 起） */
  seq: number;
  isSell: boolean;
  time: string;
  nav: number;
  /** 买入本金 / 卖出回款（份额×卖出净值） */
  amount: number;
  /** 本笔交易份额 */
  shares: number;
  /** 该步之后的摊薄成本 */
  cost: number;
  /** 该步之后的持仓份额 */
  holdingShares: number;
  /** 均价（成本÷份额，4 位）；无持仓为 null */
  avgPrice: number | null;
  /** 累计买入本金 */
  invested: number;
  /** 累计回款 */
  proceeds: number;
  /** 该笔摊薄口径已实现盈亏（买入为 0） */
  stepPnl: number;
  /** 累计摊薄已实现盈亏 */
  realizedPnl: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 份额相等判定（浮点安全，容差 1e-6）。 */
function sameShares(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

export function parseRecords(text: string): RecordsSummary {
  const buys: BuyRecord[] = [];
  const sells: SellRecord[] = [];
  // 保序事件流（摊薄模拟需按文件顺序逐笔处理）
  const events: { isSell: boolean; rec: BuyRecord }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const isSell = line.startsWith('-');
    const parts = (isSell ? line.slice(1) : line).trim().split(/\s+/);
    if (parts.length !== 4) continue; // 字段数不对的脏行跳过
    const [time, p, nav, shares] = parts;
    const rec: BuyRecord = { time, principal: Number(p), nav: Number(nav), shares: Number(shares) };
    if (![rec.principal, rec.nav, rec.shares].every(Number.isFinite)) continue; // 非数字跳过
    events.push({ isSell, rec });
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

  // 异常检测：买入份额应 ≈ 本金÷净值（两位小数舍入误差内）；偏差 >1% 视为疑似录入错误。
  // 卖出不校验（其本金字段为原买入本金，非卖出金额）。
  const anomalies: Anomaly[] = [];
  for (const b of buys) {
    if (!(b.nav > 0)) continue;
    const expected = b.principal / b.nav;
    const denom = Math.max(b.shares, expected);
    if (denom > 0 && Math.abs(b.shares - expected) / denom > 0.01) {
      anomalies.push({ time: b.time, principal: b.principal, nav: b.nav, shares: b.shares, expectedShares: round2(expected) });
    }
  }
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

  // 摊薄成本模拟（按文件顺序）：买入累加成本；卖出按当时平均成本价扣减。同步产出回放序列。
  let dilutedCost = 0;
  let liveShares = 0;
  let deductedTotal = 0;
  const timeline: TimelineStep[] = [];
  let investedRaw = 0;
  let proceedsRaw = 0;
  let realizedRaw = 0;
  for (const [seq0, ev] of events.entries()) {
    let amount = 0;
    let stepPnl = 0;
    if (!ev.isSell) {
      dilutedCost += ev.rec.principal;
      liveShares += ev.rec.shares;
      investedRaw += ev.rec.principal;
      amount = ev.rec.principal;
    } else {
      amount = ev.rec.shares * ev.rec.nav;
      proceedsRaw += amount;
      if (liveShares > 0) {
        const sold = Math.min(ev.rec.shares, liveShares);
        const deduct = sold * (dilutedCost / liveShares);
        dilutedCost -= deduct;
        deductedTotal += deduct;
        liveShares -= sold;
        stepPnl = amount - deduct;
        realizedRaw += stepPnl;
      }
    }
    timeline.push({
      seq: seq0 + 1,
      isSell: ev.isSell,
      time: ev.rec.time,
      nav: ev.rec.nav,
      amount: round2(amount),
      shares: ev.rec.shares,
      cost: round2(dilutedCost),
      holdingShares: round2(liveShares),
      avgPrice: liveShares > 0 ? round4(dilutedCost / liveShares) : null,
      invested: round2(investedRaw),
      proceeds: round2(proceedsRaw),
      stepPnl: round2(stepPnl),
      realizedPnl: round2(realizedRaw),
    });
  }
  const sellProceeds = sells.reduce((s, x) => s + x.shares * x.nav, 0);
  const totalBuyPrincipal = buys.reduce((s, x) => s + x.principal, 0);

  return {
    rows,
    realizedPnl: round2(realizedPnl),
    soldPrincipal: round2(soldPrincipal),
    holdingPrincipal: round2(holdingPrincipal),
    holdingShares: round2(holdingShares),
    unmatchedSells,
    anomalies,
    diluted: {
      cost: round2(dilutedCost),
      costPrice: liveShares > 0 ? round4(dilutedCost / liveShares) : null,
      realizedPnl: round2(sellProceeds - deductedTotal),
    },
    totalBuyPrincipal: round2(totalBuyPrincipal),
    sellProceeds: round2(sellProceeds),
    accountBreakEvenNav: liveShares > 0 ? round4((totalBuyPrincipal - sellProceeds) / liveShares) : null,
    latestSellNav: sells.length > 0 ? (sells[sells.length - 1].nav as number) : null,
    timeline,
  };
}
