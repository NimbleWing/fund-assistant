// 天天基金历史净值抓取：lsjz 接口（需 Referer 头，每页上限 20 条）。
// 第三方字段在归一化层映射为领域术语：FSRQ → date，DWJZ → unitNav。
import type { FetchLike } from '../funds/search.ts';

const LSJZ_URL = (code: string) =>
  `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=20`;
const TIMEOUT_MS = 8000;

/** 一条净值历史（领域术语）。 */
export interface NavPoint {
  /** 净值日期 YYYY-MM-DD */
  date: string;
  /** 单位净值 */
  unitNav: number;
}

/** 归一化 lsjz 响应；非法结构/脏行跳过（无有效数据返回空列表）。 */
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

/** 拉取某基金第一页历史净值（最近 20 个交易日）；远端失败/超时返回 null。 */
export async function fetchNavHistory(code: string, fetchImpl: FetchLike = fetch): Promise<NavPoint[] | null> {
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
