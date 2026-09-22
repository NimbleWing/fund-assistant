// 持仓估值汇总：关注基金 → 进行中轮（持有份额 > 0）→ 盘中估值，计算预估涨跌额。
// 预估涨跌额 = 持有份额 ×（预估净值 − 最新净值）（盘中语义：最新净值即昨收）。
// fetch 注入便于测试；服务不可达返回 null（面板隐藏该区域），单只估值不可用容忍（字段为 null）。
import { SERVER_ORIGIN } from './config.ts';

export interface HoldingEstimate {
  code: string;
  name: string;
  /** 持有份额 */
  shares: number;
  /** 预估涨跌幅（%，相对昨收）；估值不可用为 null */
  estChangePct: number | null;
  /** 预估涨跌额（元）；估值不可用为 null */
  estChangeAmount: number | null;
  /** 估值时间 YYYY-MM-DD HH:mm */
  gztime: string | null;
}

interface WatchlistResp {
  ok: boolean;
  rows?: { code: string; name: string }[];
}
interface RoundsResp {
  ok: boolean;
  rounds?: { status: string; metrics: { holdingShares: number } }[];
}
interface EstimateResp {
  ok: boolean;
  estimate?: { gsz: number; gszzl: number; dwjz: number; gztime: string };
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 汇总持仓估值：服务不可达/关注列表失败 → null；无进行中轮或零持仓的基金跳过。 */
export async function fetchHoldingEstimates(
  fetchImpl: typeof fetch = fetch,
  origin: string = SERVER_ORIGIN,
  timeoutMs = 5000,
): Promise<HoldingEstimate[] | null> {
  let watch: WatchlistResp;
  try {
    watch = await getJson<WatchlistResp>(fetchImpl, `${origin}/api/watchlist`, timeoutMs);
  } catch {
    return null;
  }
  if (!watch.ok || !watch.rows) return null;

  const out: HoldingEstimate[] = [];
  for (const f of watch.rows) {
    let rounds: RoundsResp;
    try {
      rounds = await getJson<RoundsResp>(fetchImpl, `${origin}/api/rounds?fund=${encodeURIComponent(f.code)}`, timeoutMs);
    } catch {
      continue;
    }
    const active = rounds.rounds?.find((r) => r.status === 'active');
    const shares = active?.metrics.holdingShares ?? 0;
    if (!active || !(shares > 0)) continue;

    // 估值不可用（远端失败/非交易时段/QDII 无估值）不阻塞，该行字段置 null
    let est: EstimateResp['estimate'] | null = null;
    try {
      const e = await getJson<EstimateResp>(fetchImpl, `${origin}/api/funds/${encodeURIComponent(f.code)}/estimate`, timeoutMs);
      if (e.ok && e.estimate) est = e.estimate;
    } catch {
      est = null;
    }
    out.push({
      code: f.code,
      name: f.name,
      shares,
      estChangePct: est?.gszzl ?? null,
      estChangeAmount: est ? Math.round(shares * (est.gsz - est.dwjz) * 100) / 100 : null,
      gztime: est?.gztime ?? null,
    });
  }
  return out;
}
