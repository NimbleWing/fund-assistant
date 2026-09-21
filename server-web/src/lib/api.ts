// 服务 API 客户端：统一超时与错误归一（开发服下 /api 由 vite 代理到本地服务）。
export interface HealthInfo {
  ok: boolean;
  service: string;
}

export async function fetchHealth(timeoutMs = 2000): Promise<HealthInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 临时分析：买卖记录（数据源 buyAndSellRecord.txt，由 server 解析配对） ----

export interface PairRow {
  buyTime: string;
  principal: number;
  buyNav: number;
  shares: number;
  sellTime: string | null;
  sellNav: number | null;
  /** 已实现盈亏；持有中为 null */
  pnl: number | null;
}

/** 回放单步：一笔交易明细 + 该步之后的摊薄口径状态快照（过程回放页签数据源）。 */
export interface TimelineStep {
  seq: number;
  isSell: boolean;
  time: string;
  nav: number;
  /** 买入本金 / 卖出回款 */
  amount: number;
  shares: number;
  cost: number;
  holdingShares: number;
  /** 均价；无持仓为 null */
  avgPrice: number | null;
  invested: number;
  proceeds: number;
  /** 该笔摊薄口径已实现盈亏（买入为 0） */
  stepPnl: number;
  realizedPnl: number;
}

export interface RecordsData {
  ok: boolean;
  rows: PairRow[];
  realizedPnl: number;
  soldPrincipal: number;
  holdingPrincipal: number;
  holdingShares: number;
  unmatchedSells: { time: string; shares: number }[];
  /** 买入份额与 本金÷净值 偏差超 1% 的疑似录入错误 */
  anomalies: { time: string; principal: number; nav: number; shares: number; expectedShares: number }[];
  /** 摊薄成本口径（对齐基金 App 的「持仓收益」） */
  diluted: { cost: number; costPrice: number | null; realizedPnl: number };
  totalBuyPrincipal: number;
  sellProceeds: number;
  /** 账户回本净值（总盈亏归零所需净值）；无持仓为 null */
  accountBreakEvenNav: number | null;
  /** 最后一条卖出的确认净值（默认「最新净值」）；无卖出为 null */
  latestSellNav: number | null;
  /** 逐笔回放序列（按文件顺序） */
  timeline: TimelineStep[];
  error?: string;
}

export async function fetchRecords(timeoutMs = 5000): Promise<RecordsData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/records', { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as RecordsData;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
