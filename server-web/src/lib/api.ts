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

// ---- 基金搜索（server 代理天天基金 suggest，实时请求无本地缓存） ----

export interface FundHit {
  code: string;
  name: string;
  /** 基金类型；缺失为 null */
  type: string | null;
}

export interface FundSearchData {
  ok: boolean;
  hits?: FundHit[];
  error?: string;
}

/** 实时搜索：signal 由调用方控制（竞态丢弃）；超时/断网返回 null，远端失败返回 ok:false。 */
export async function searchFunds(keyword: string, signal?: AbortSignal, timeoutMs = 6000): Promise<FundSearchData | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onExternalAbort);
  try {
    const res = await fetch(`/api/funds/search?q=${encodeURIComponent(keyword)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as FundSearchData;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

// ---- 关注基金列表（server 端 SQLite 持久化；取消关注为软删除） ----

export interface WatchRow {
  id: number;
  code: string;
  name: string;
  type: string | null;
  /** 1 关注中 / 0 已软删除（GET 列表只返回 1） */
  active?: number;
  created_at: string;
  updated_at: string;
}

export interface WatchlistData {
  ok: boolean;
  rows?: WatchRow[];
  row?: WatchRow;
  removed?: boolean;
  error?: string;
}

async function callApi<T>(path: string, init?: RequestInit, timeoutMs = 5000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchWatchlist(): Promise<WatchlistData | null> {
  return callApi<WatchlistData>('/api/watchlist');
}

export function followFund(fund: { code: string; name: string; type: string | null }): Promise<WatchlistData | null> {
  return callApi<WatchlistData>('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fund),
  });
}

export function unfollowFund(code: string): Promise<WatchlistData | null> {
  return callApi<WatchlistData>(`/api/watchlist/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

// ---- 基金净值历史（fund.db fund_nav 表；启动同步 + 手动补录） ----

export interface NavRow {
  id: number;
  /** 净值日期 YYYY-MM-DD */
  date: string;
  /** 单位净值 */
  unitNav: number;
  createdAt: string;
}

/** 固化预估净值（fund.db fund_est_nav 表；交易日 16:00 后服务端自动固化） */
export interface EstNavRow {
  id: number;
  /** 估值日期 YYYY-MM-DD */
  date: string;
  /** 固化预估净值 */
  estimatedNav: number;
  /** 固化预估涨跌幅（%，相对昨收） */
  estimatedPct: number;
  /** 估值时间 YYYY-MM-DD HH:mm */
  estTime: string;
  createdAt: string;
}

export interface FundNavsData {
  ok: boolean;
  fund?: { code: string; name: string; type: string | null };
  rows?: NavRow[];
  estRows?: EstNavRow[];
  error?: string;
}

export function fetchFundNavs(code: string): Promise<FundNavsData | null> {
  return callApi<FundNavsData>(`/api/funds/${encodeURIComponent(code)}/navs`);
}

/** 手动补录；已存在日期返回 ok:true, inserted:false（不覆盖）。 */
export function addFundNav(code: string, date: string, unitNav: number): Promise<{ ok: boolean; inserted?: boolean; error?: string } | null> {
  return callApi(`/api/funds/${encodeURIComponent(code)}/nav`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, unitNav }),
  });
}

// ---- 轮次（round/round_txn 表；进行中动态计算，已清仓读快照） ----

export interface RoundTxn {
  id: number;
  direction: 'buy' | 'sell';
  /** 买入/卖出时间（=确认日） */
  date: string;
  /** 本金（买）/ 回款（卖，实际到账 = 份额×净值−手续费） */
  amount: number;
  /** 确认净值 */
  nav: number;
  /** 确认份额 */
  shares: number;
  /** 手续费（仅卖出有意义，买入为 0） */
  fee: number;
  /** 显式配对的买入交易 id（仅卖出；null = 自动 FIFO） */
  pairBuyId: number | null;
}

export interface RoundMetrics {
  buyCount: number;
  sellCount: number;
  invested: number;
  proceeds: number;
  realizedPnl: number;
  soldPrincipal: number;
  holdingPrincipal: number;
  holdingShares: number;
  dilutedCost: number;
  dilutedRealizedPnl: number;
  latestNav: number | null;
  marketValue: number | null;
  floatingPnl: number | null;
  dilutedHoldingPnl: number | null;
  totalPnl: number | null;
  /** 浮动盈亏率（%）；无持仓本金或无净值时为 null */
  floatingPnlPct: number | null;
  /** 轮总盈亏率（%）；无投入时为 null */
  totalPnlPct: number | null;
}

/** 持有中的买入批次（卖出录入的显式配对选项）。 */
export interface OpenBuyLot {
  /** 买入交易 id */
  id: number;
  date: string;
  nav: number;
  /** 剩余份额 */
  shares: number;
  /** 剩余本金 */
  principal: number;
}

export interface RoundData {
  id: number;
  fundCode: string;
  seq: number;
  status: 'active' | 'closed';
  createdAt: string;
  closedAt: string | null;
  metrics: RoundMetrics;
  /** 持有中的买入批次（进行中轮动态计算；已清仓轮恒为空） */
  openBuys: OpenBuyLot[];
  txns: RoundTxn[];
}

export function fetchRounds(fundCode: string): Promise<{ ok: boolean; rounds?: RoundData[]; error?: string } | null> {
  return callApi(`/api/rounds?fund=${encodeURIComponent(fundCode)}`);
}

export function createRound(fundCode: string): Promise<{ ok: boolean; round?: RoundData; error?: string } | null> {
  return callApi('/api/rounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fundCode }),
  });
}

export function addRoundTxn(roundId: number, txn: Omit<RoundTxn, 'id'>): Promise<{ ok: boolean; round?: RoundData; error?: string } | null> {
  return callApi(`/api/rounds/${roundId}/txns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txn),
  });
}

export function deleteRoundTxn(roundId: number, txnId: number): Promise<{ ok: boolean; round?: RoundData; error?: string } | null> {
  return callApi(`/api/rounds/${roundId}/txns/${txnId}`, { method: 'DELETE' });
}

export function closeRound(roundId: number): Promise<{ ok: boolean; round?: RoundData; error?: string } | null> {
  return callApi(`/api/rounds/${roundId}/close`, { method: 'POST' });
}
