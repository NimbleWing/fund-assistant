// 轮指标口径公式文案（ⓘ 提示气泡内容），口径与 domain_models/CONTEXT.md 保持一致。
export const METRIC_FORMULAS: Record<string, string> = {
  buyCount: '买入次数 = 本轮买入记录条数',
  sellCount: '卖出次数 = 本轮卖出记录条数',
  invested: '轮总投入 = 本轮全部买入本金之和',
  proceeds: '轮累计回款 = 本轮全部卖出回款之和（单笔回款 = 确认份额 × 卖出净值 − 手续费）',
  realizedPnl: '轮已实现盈亏 = 已配对的配对盈亏之和（配对盈亏 = 确认份额 × 卖出净值 − 本金；显式配对优先，未指定按 FIFO）',
  soldPrincipal: '已卖本金 = 已卖出份额按逐笔配对（显式配对优先，未指定按 FIFO）消耗的买入本金之和',
  holdingPrincipal: '轮持有本金 = 持有中（未配对卖出）买入批次的本金之和，逐笔配对口径',
  holdingShares: '轮持有份额 = 本轮买入份额 − 卖出份额',
  marketValue: '轮持仓市值 = 轮持有份额 × 最新净值',
  floatingPnl: '浮动盈亏 = 持仓市值 − 持有本金，反映剩余份额真实盈亏成色；浮动盈亏率 = 浮动盈亏 ÷ 持有本金',
  dilutedHoldingPnl: '持仓收益·摊薄 = 持仓市值 − 摊薄成本（移动平均：卖出按当时均价扣减，盈亏滚入成本）；仅用于与基金 App 对账，不作盈亏决策依据',
  totalPnl: '轮总盈亏 = 持仓市值 + 累计回款 − 轮总投入 = 已实现盈亏 + 浮动盈亏（唯一不受成本口径影响的轮级盈亏）；轮总盈亏率 = 轮总盈亏 ÷ 轮总投入',
};
