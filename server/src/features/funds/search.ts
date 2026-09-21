// 基金实时搜索：代理天天基金 suggest 接口（浏览器直连有跨域问题）。
// 响应归一化为 {code, name, type}（type 取 FundBaseInfo.FTYPE）；远端失败/超时/结构异常返回 null。

const SUGGEST_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=';
const TIMEOUT_MS = 5000;
const MAX_RESULTS = 20;

export interface FundHit {
  code: string;
  name: string;
  /** 基金类型（如 债券型-混合一级）；缺失为 null */
  type: string | null;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** 归一化 suggest 响应：非法结构返回空列表（由调用方区分远端失败）。 */
export function normalizeSuggest(body: unknown): FundHit[] {
  if (body == null || typeof body !== 'object') return [];
  const datas = (body as { Datas?: unknown }).Datas;
  if (!Array.isArray(datas)) return [];
  const hits: FundHit[] = [];
  for (const d of datas) {
    if (d == null || typeof d !== 'object') continue;
    const { CODE, NAME, FundBaseInfo } = d as { CODE?: unknown; NAME?: unknown; FundBaseInfo?: unknown };
    if (typeof CODE !== 'string' || typeof NAME !== 'string') continue;
    const ftype =
      FundBaseInfo != null && typeof FundBaseInfo === 'object'
        ? (FundBaseInfo as { FTYPE?: unknown }).FTYPE
        : null;
    hits.push({ code: CODE, name: NAME, type: typeof ftype === 'string' ? ftype : null });
    if (hits.length >= MAX_RESULTS) break;
  }
  return hits;
}

/** 实时搜索：空关键词返回 []；远端失败/超时返回 null（路由层转 ok:false）。 */
export async function searchFunds(keyword: string, fetchImpl: FetchLike = fetch): Promise<FundHit[] | null> {
  const q = keyword.trim();
  if (!q) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(SUGGEST_URL + encodeURIComponent(q), { signal: ctrl.signal });
    if (!res.ok) return null;
    return normalizeSuggest(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
