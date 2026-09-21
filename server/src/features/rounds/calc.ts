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
}

interface Replay {
  lots: Lot[];
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

/** 从指定批次消耗 take 份额，按份额比例扣本金；耗尽则移除批次。返回消耗的本金。 */
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
      lots.push({ id: t.id, shares: t.shares, principal: t.amount });
      r.dilutedCost += t.amount;
      continue;
    }
    // 卖出：显式配对批次优先，剩余 FIFO 分批消耗
    r.sellCount += 1;
    r.proceeds += t.amount;
    const beforeShares = r.holdingShares;
    let remaining = t.shares;
    let consumed = 0;
    if (t.pairBuyId != null) {
      const idx = lots.findIndex((l) => l.id === t.pairBuyId);
      if (idx >= 0) {
        const take = Math.min(remaining, (lots[idx] as Lot).shares);
        consumed += consume(lots, idx, take);
        remaining -= take;
      }
    }
    while (remaining > EPS && lots.length > 0) {
      const take = Math.min(remaining, (lots[0] as Lot).shares);
      consumed += consume(lots, 0, take);
      remaining -= take;
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
  };
}
