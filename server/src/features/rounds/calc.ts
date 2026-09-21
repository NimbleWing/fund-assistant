// 轮指标纯计算：逐笔配对用 FIFO 分批消耗（一次卖出可跨多笔买入，按份额比例消耗本金）；
// 摊薄口径为移动平均（买入累加、卖出按当时均价扣减，盈亏滚入成本总额）。
// 需要最新净值的指标（市值/浮动/摊薄持仓收益/总盈亏）在无净值数据时为 null。
export interface RoundTxnInput {
  direction: 'buy' | 'sell';
  /** 本金（买）/ 回款（卖） */
  amount: number;
  /** 确认净值 */
  nav: number;
  /** 确认份额 */
  shares: number;
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

export function calcRound(txns: RoundTxnInput[], latestNav: number | null): RoundMetrics {
  const lots: { shares: number; principal: number }[] = [];
  let buyCount = 0;
  let sellCount = 0;
  let invested = 0;
  let proceeds = 0;
  let realizedPnl = 0;
  let soldPrincipal = 0;
  let holdingShares = 0;
  let dilutedCost = 0;
  let dilutedRealizedPnl = 0;

  for (const t of txns) {
    if (t.direction === 'buy') {
      buyCount += 1;
      invested += t.amount;
      holdingShares += t.shares;
      lots.push({ shares: t.shares, principal: t.amount });
      dilutedCost += t.amount;
      continue;
    }
    // 卖出：FIFO 分批消耗买入批次
    sellCount += 1;
    proceeds += t.amount;
    const beforeShares = holdingShares;
    let remaining = t.shares;
    let consumed = 0;
    while (remaining > EPS && lots.length > 0) {
      const lot = lots[0] as { shares: number; principal: number };
      const take = Math.min(remaining, lot.shares);
      const used = lot.principal * (take / lot.shares);
      lot.principal -= used;
      lot.shares -= take;
      consumed += used;
      remaining -= take;
      if (lot.shares <= EPS) lots.shift();
    }
    realizedPnl += t.amount - consumed;
    soldPrincipal += consumed;
    holdingShares -= t.shares;
    // 摊薄：按卖出前平均成本扣减
    if (beforeShares > EPS) {
      const deduct = t.shares * (dilutedCost / beforeShares);
      dilutedCost -= deduct;
      dilutedRealizedPnl += t.amount - deduct;
    }
  }

  const holdingPrincipal = lots.reduce((s, l) => s + l.principal, 0);
  const shares = Math.abs(holdingShares) < EPS ? 0 : holdingShares;
  const marketValue = latestNav != null ? round2(shares * latestNav) : null;

  return {
    buyCount,
    sellCount,
    invested: round2(invested),
    proceeds: round2(proceeds),
    realizedPnl: round2(realizedPnl),
    soldPrincipal: round2(soldPrincipal),
    holdingPrincipal: round2(holdingPrincipal),
    holdingShares: round2(shares),
    dilutedCost: round2(dilutedCost),
    dilutedRealizedPnl: round2(dilutedRealizedPnl),
    latestNav,
    marketValue,
    floatingPnl: marketValue != null ? round2(marketValue - holdingPrincipal) : null,
    dilutedHoldingPnl: marketValue != null ? round2(marketValue - dilutedCost) : null,
    totalPnl: marketValue != null ? round2(marketValue + proceeds - invested) : null,
  };
}
