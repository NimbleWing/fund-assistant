// 持仓估值汇总：关注基金 → 进行中轮（持有份额 > 0）→ 盘中估值，计算预估涨跌额。
// 预估涨跌额 = 持有份额 ×（预估净值 − 最新净值）（盘中语义：最新净值即昨收）。
// 净值更新状态 = 该基金 fund_nav 最新日期 ≥ 服务端期望净值日期（20:00 前上一交易日、周末回退周五、节假日不识别）。
// fetch 注入便于测试；服务不可达返回 null（面板隐藏该区域），单只估值不可用容忍（字段为 null）。
import { SERVER_ORIGIN } from './config.ts';
import { getJson } from './http.ts';

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
  /** 最新净值（fund_nav 最新一条）；无记录为 null */
  latestNav: number | null;
  /** 最新净值日期 YYYY-MM-DD */
  latestNavDate: string | null;
  /** 期望净值日期 YYYY-MM-DD（服务端未返回时为 null，面板不展示更新状态） */
  expectedNavDate: string | null;
  /** 今日（期望日期）净值是否已更新；expectedNavDate 缺失时为 null */
  navUpdated: boolean | null;
}

interface WatchlistResp {
  ok: boolean;
  rows?: { code: string; name: string; latestNavDate?: string | null; latestUnitNav?: number | null }[];
  /** 期望净值日期（服务端 0.x 新增；旧版本缺失） */
  expectedNavDate?: string;
}
interface RoundsResp {
  ok: boolean;
  rounds?: { status: string; metrics: { holdingShares: number } }[];
}
interface EstimateResp {
  ok: boolean;
  estimate?: { gsz: number; gszzl: number; dwjz: number; gztime: string };
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
  const expectedNavDate = typeof watch.expectedNavDate === 'string' ? watch.expectedNavDate : null;

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
      latestNav: f.latestUnitNav ?? null,
      latestNavDate: f.latestNavDate ?? null,
      expectedNavDate,
      // 无期望日期（旧服务端）→ null 不展示；有期望日期但无净值记录 → 未更新
      navUpdated: expectedNavDate == null ? null : f.latestNavDate != null && f.latestNavDate >= expectedNavDate,
    });
  }
  return out;
}
