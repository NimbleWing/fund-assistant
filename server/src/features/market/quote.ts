// 大盘指数行情：代理新浪行情 hq.sinajs.cn s_ 简式接口（浏览器直连有跨域问题）。
// 响应为 var hq_str_s_{code}="名称,最新价,涨跌额,涨跌幅%,成交量(手),成交额(万元)";（GBK 编码，
// 名称不可靠，由调用方固定；仅取数字字段）。远端失败/超时/结构非法返回 null。
import type { FetchLike } from '../funds/search.ts';

const QUOTE_URL = 'https://hq.sinajs.cn/rn=';
const TIMEOUT_MS = 5000;

export interface IndexQuote {
  /** 指数代码（如 sh000001） */
  code: string;
  /** 最新点位 */
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅（%） */
  changePct: number;
}

/** 解析 s_ 简式行情串；结构非法或数值非法返回 null。 */
export function normalizeIndexQuote(code: string, text: string): IndexQuote | null {
  const m = /^var hq_str_s_\w+="([^"]*)";?\s*$/.exec(text.trim());
  if (!m) return null;
  const parts = (m[1] as string).split(',');
  // 字段位：1=最新价 2=涨跌额 3=涨跌幅%
  if (parts.length < 4) return null;
  const price = Number(parts[1]);
  const change = Number(parts[2]);
  const changePct = Number(parts[3]);
  if (!(price > 0) || !Number.isFinite(change) || !Number.isFinite(changePct)) return null;
  return { code, price, change, changePct };
}

/** 拉取指数行情；远端失败/超时/结构非法返回 null（路由层转 ok:false）。rn 防缓存参数须在 list 之前。 */
export async function fetchIndexQuote(code: string, fetchImpl: FetchLike = fetch): Promise<IndexQuote | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${QUOTE_URL}${Date.now()}&list=s_${encodeURIComponent(code)}`, {
      signal: ctrl.signal,
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    if (!res.ok) return null;
    return normalizeIndexQuote(code, await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
