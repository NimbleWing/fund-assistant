// 天天基金净值抓取，两个数据源按需使用：
// - fetchNavHistory：pingzhongdata/{code}.js 的 Data_netWorthTrend（单请求全量历史，关注基金时用）
// - fetchLatestNavs：f10/lsjz 第一页（每页上限 20 条，启动同步/20 点轮询等「只补最新」场景用，轻量）
// 第三方字段在归一化层映射为领域术语：x（北京时间零点毫秒时间戳）/FSRQ → date，y/DWJZ → unitNav。
// equityReturn（日涨幅）暂不入库。
import type { FetchLike } from '../funds/search.ts';

const DATA_URL = (code: string) => `https://fund.eastmoney.com/pingzhongdata/${encodeURIComponent(code)}.js`;
const LSJZ_URL = (code: string) =>
  `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=20`;
const TIMEOUT_MS = 10000;
/** 北京时间零点时间戳 → 净值日期：+8h 后取 UTC 日期，不受服务器时区影响 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 一条净值历史（领域术语）。 */
export interface NavPoint {
  /** 净值日期 YYYY-MM-DD */
  date: string;
  /** 单位净值 */
  unitNav: number;
}

/** 归一化 pingzhongdata 响应文本（全量）；提取失败/脏行跳过（无有效数据返回空列表）。 */
export function normalizeNetWorthTrend(text: string): NavPoint[] {
  const m = /Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/.exec(text);
  if (!m || m[1] == null) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const points: NavPoint[] = [];
  for (const item of arr) {
    if (item == null || typeof item !== 'object') continue;
    const { x, y } = item as { x?: unknown; y?: unknown };
    const ts = Number(x);
    const unitNav = Number(y);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (!Number.isFinite(unitNav) || unitNav <= 0) continue;
    points.push({ date: new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10), unitNav });
  }
  return points;
}

/** 归一化 lsjz 响应（最近 20 条）；非法结构/脏行跳过。 */
export function normalizeLsjz(body: unknown): NavPoint[] {
  if (body == null || typeof body !== 'object') return [];
  const data = (body as { Data?: unknown }).Data;
  if (data == null || typeof data !== 'object') return [];
  const list = (data as { LSJZList?: unknown }).LSJZList;
  if (!Array.isArray(list)) return [];
  const points: NavPoint[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object') continue;
    const { FSRQ, DWJZ } = item as { FSRQ?: unknown; DWJZ?: unknown };
    const unitNav = Number(DWJZ);
    if (typeof FSRQ !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(FSRQ)) continue;
    if (!Number.isFinite(unitNav) || unitNav <= 0) continue;
    points.push({ date: FSRQ, unitNav });
  }
  return points;
}

/** 拉取某基金全量历史净值（关注时调用）；远端失败/超时/格式异常返回 null。 */
export async function fetchNavHistory(code: string, fetchImpl: FetchLike = fetch): Promise<NavPoint[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(DATA_URL(code), { signal: ctrl.signal });
    if (!res.ok) return null;
    return normalizeNetWorthTrend(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取某基金最近 20 条净值（启动同步/轮询用）；远端失败/超时返回 null。 */
export async function fetchLatestNavs(code: string, fetchImpl: FetchLike = fetch): Promise<NavPoint[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(LSJZ_URL(code), {
      signal: ctrl.signal,
      headers: { Referer: 'https://fundf10.eastmoney.com/' },
    });
    if (!res.ok) return null;
    return normalizeLsjz(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
