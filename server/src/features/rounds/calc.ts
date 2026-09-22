// 轮指标纯计算：逐笔配对——卖出可显式指定配对买入批次（pairBuyId，优先消耗该批次，
// 不足部分退回 FIFO），未指定时纯 FIFO 分批消耗（按份额比例消耗本金）；
// 摊薄口径为移动平均（买入累加、卖出按当时均价扣减，盈亏滚入成本总额）。
// 需要最新净值的指标（市值/浮动/摊薄持仓收益/总盈亏）在无净值数据时为 null。
export interface RoundTxnInput {
  /** 交易 id（显式配对与 openBuyLots 定位批次用；纯数字演算可省略） */
  id?: number;
  direction: 'buy' | 'sell';
  /** 本金（买）/ 回款（卖） */
  amount: number;
  /** 确认净值 */
  nav: number;
  /** 确认份额 */
  shares: number;
  /** 显式配对的买入交易 id（仅卖出有意义；缺省为自动 FIFO） */
  pairBuyId?: number | null;
}

export interface RoundMetrics {
  buyCount: number;
  sellCount: number;
  /** 轮总投入 */
  invested: number;
  /** 轮累计回款 */
  proceeds: number;
  /** 已实现盈亏（逐笔配对 FIFO） */
  realizedPnl: number;
  /** 已卖本金（FIFO 消耗的买入本金） */
  soldPrincipal: number;
  /** 持有本金（FIFO 剩余批次的本金） */
  holdingPrincipal: number;
  /** 持有份额 */
  holdingShares: number;
  /** 摊薄成本 */
  dilutedCost: number;
  /** 摊薄口径已实现盈亏 */
  dilutedRealizedPnl: number;
  latestNav: number | null;
  /** 轮持仓市值 */
  marketValue: number | null;
  /** 浮动盈亏 */
  floatingPnl: number | null;
  /** 持仓收益·摊薄（仅对账） */
  dilutedHoldingPnl: number | null;
  /** 轮总盈亏 */
  totalPnl: number | null;
  /** 浮动盈亏率（%）：浮动盈亏 ÷ 持有本金；无持仓本金或无净值时为 null */
  floatingPnlPct: number | null;
  /** 轮总盈亏率（%）：轮总盈亏 ÷ 轮总投入；无投入或无净值时为 null */
  totalPnlPct: number | null;
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 持有中的买入批次（配对消耗后的剩余份额与本金）。 */
export interface OpenBuyLot {
  /** 买入交易 id（输入未带 id 时为 undefined） */
  id?: number;
  shares: number;
  principal: number;
}

interface Lot {
  id?: number;
  shares: number;
  principal: number;
  /** 已卖出部分归因到本批次的已实现盈亏（跨批次卖出按消耗本金比例分摊回款） */
  realized: number;
}

interface Replay {
  lots: Lot[];
  /** 全部买入批次（含已耗尽），保持买入顺序，供批次盈亏归因 */
  allLots: Lot[];
  buyCount: number;
  sellCount: number;
  invested: number;
  proceeds: number;
  realizedPnl: number;
  soldPrincipal: number;
  holdingShares: number;
  dilutedCost: number;
  dilutedRealizedPnl: number;
}

/** 从指定批次消耗 take 份额，按份额比例扣本金；耗尽则移出持有列表（批次对象仍留在 allLots）。返回消耗的本金。 */
function consume(lots: Lot[], idx: number, take: number): number {
  const lot = lots[idx] as Lot;
  const used = lot.principal * (take / lot.shares);
  lot.principal -= used;
  lot.shares -= take;
  if (lot.shares <= EPS) lots.splice(idx, 1);
  return used;
}

/** 按交易顺序回放：显式配对优先消耗指定批次，剩余份额退回 FIFO；摊薄口径同步推进。 */
function replay(txns: RoundTxnInput[]): Replay {
  const lots: Lot[] = [];
  const r: Replay = {
    lots,
    allLots: [],
    buyCount: 0,
    sellCount: 0,
    invested: 0,
    proceeds: 0,
    realizedPnl: 0,
    soldPrincipal: 0,
    holdingShares: 0,
    dilutedCost: 0,
    dilutedRealizedPnl: 0,
  };
  for (const t of txns) {
    if (t.direction === 'buy') {
      r.buyCount += 1;
      r.invested += t.amount;
      r.holdingShares += t.shares;
      const lot: Lot = { id: t.id, shares: t.shares, principal: t.amount, realized: 0 };
      lots.push(lot);
      r.allLots.push(lot);
      r.dilutedCost += t.amount;
      continue;
    }
    // 卖出：显式配对批次优先，剩余 FIFO 分批消耗
    r.sellCount += 1;
    r.proceeds += t.amount;
    const beforeShares = r.holdingShares;
    let remaining = t.shares;
    let consumed = 0;
    // 本笔卖出消耗的各批次与本金（供回款按比例分摊归因）
    const allocs: { lot: Lot; used: number }[] = [];
    if (t.pairBuyId != null) {
      const idx = lots.findIndex((l) => l.id === t.pairBuyId);
      if (idx >= 0) {
        const lot = lots[idx] as Lot;
        const take = Math.min(remaining, lot.shares);
        const used = consume(lots, idx, take);
        allocs.push({ lot, used });
        consumed += used;
        remaining -= take;
      }
    }
    while (remaining > EPS && lots.length > 0) {
      const lot = lots[0] as Lot;
      const take = Math.min(remaining, lot.shares);
      const used = consume(lots, 0, take);
      allocs.push({ lot, used });
      consumed += used;
      remaining -= take;
    }
    // 回款按各批次消耗本金比例分摊，归因批次已实现盈亏（合计恰为 本笔回款 − 消耗本金）
    if (consumed > EPS) {
      for (const a of allocs) a.lot.realized += t.amount * (a.used / consumed) - a.used;
    }
    r.realizedPnl += t.amount - consumed;
    r.soldPrincipal += consumed;
    r.holdingShares -= t.shares;
    // 摊薄：按卖出前平均成本扣减
    if (beforeShares > EPS) {
      const deduct = t.shares * (r.dilutedCost / beforeShares);
      r.dilutedCost -= deduct;
      r.dilutedRealizedPnl += t.amount - deduct;
    }
  }
  return r;
}

/** 当前持有中的买入批次（含剩余份额/本金），供卖出录入的配对选择。 */
export function openBuyLots(txns: RoundTxnInput[]): OpenBuyLot[] {
  return replay(txns)
    .lots.filter((l) => l.shares > EPS)
    .map((l) => ({ id: l.id, shares: round2(l.shares), principal: round2(l.principal) }));
}

/** 单个买入批次的盈亏归因。 */
export interface BuyLotPnl {
  /** 买入交易 id（输入未带 id 时为 undefined） */
  id?: number;
  /** 剩余持有份额（0 = 该批次已清仓） */
  holdingShares: number;
  /** 已实现部分：已卖出份额按配对卖出归因（跨批次卖出的回款按消耗本金比例分摊） */
  realizedPnl: number;
  /** 浮动部分：剩余份额 × 最新净值 − 剩余本金；无剩余或无最新净值时为 null */
  floatingPnl: number | null;
}

/** 各买入批次的盈亏归因（买入顺序），供当前轮次页交易表逐行展示。 */
export function buyLotPnl(txns: RoundTxnInput[], latestNav: number | null): BuyLotPnl[] {
  return replay(txns).allLots.map((l) => ({
    id: l.id,
    holdingShares: round2(l.shares),
    realizedPnl: round2(l.realized),
    floatingPnl: latestNav != null && l.shares > EPS ? round2(l.shares * latestNav - l.principal) : null,
  }));
}

/** 满 N 天持有份额：真实持有期口径（对齐基金公司赎回费先进先出规则）——买卖按传入顺序（时间序）
 * 回放，卖出恒消耗最早买入的份额（与账务配对 pairBuyId 无关），剩余份额中买入日期距今超过 days 天
 * （> days，不含第 days 天当天）的部分求和。
 * 日期为 YYYY-MM-DD，按 UTC 比较避免时区误差；today 同格式。 */
export function sharesHeldOver(txns: { direction: 'buy' | 'sell'; date: string; shares: number }[], days: number, today: string): number {
  const ms = (d: string): number => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1);
  };
  const cutoff = ms(today) - days * 86_400_000;
  const lots: { date: number; shares: number }[] = [];
  for (const t of txns) {
    if (t.direction === 'buy') {
      lots.push({ date: ms(t.date), shares: t.shares });
      continue;
    }
    let remaining = t.shares;
    while (remaining > EPS && lots.length > 0) {
      const lot = lots[0] as { date: number; shares: number };
      const take = Math.min(remaining, lot.shares);
      lot.shares -= take;
      remaining -= take;
      if (lot.shares <= EPS) lots.shift();
    }
  }
  return round2(lots.reduce((s, l) => (l.date < cutoff ? s + l.shares : s), 0));
}

export function calcRound(txns: RoundTxnInput[], latestNav: number | null): RoundMetrics {
  const r = replay(txns);
  const holdingPrincipal = r.lots.reduce((s, l) => s + l.principal, 0);
  const shares = Math.abs(r.holdingShares) < EPS ? 0 : r.holdingShares;
  const marketValue = latestNav != null ? round2(shares * latestNav) : null;

  return {
    buyCount: r.buyCount,
    sellCount: r.sellCount,
    invested: round2(r.invested),
    proceeds: round2(r.proceeds),
    realizedPnl: round2(r.realizedPnl),
    soldPrincipal: round2(r.soldPrincipal),
    holdingPrincipal: round2(holdingPrincipal),
    holdingShares: round2(shares),
    dilutedCost: round2(r.dilutedCost),
    dilutedRealizedPnl: round2(r.dilutedRealizedPnl),
    latestNav,
    marketValue,
    floatingPnl: marketValue != null ? round2(marketValue - holdingPrincipal) : null,
    dilutedHoldingPnl: marketValue != null ? round2(marketValue - r.dilutedCost) : null,
    totalPnl: marketValue != null ? round2(marketValue + r.proceeds - r.invested) : null,
    floatingPnlPct: marketValue != null && holdingPrincipal > EPS ? round2(((marketValue - holdingPrincipal) / holdingPrincipal) * 100) : null,
    totalPnlPct: marketValue != null && r.invested > EPS ? round2(((marketValue + r.proceeds - r.invested) / r.invested) * 100) : null,
  };
}
