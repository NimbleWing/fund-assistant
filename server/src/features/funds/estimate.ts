// 基金实时估值：代理新浪行情 hq.sinajs.cn（盘中估值，浏览器直连有跨域问题）。
// 响应为 var hq_str_fu_{code}="名称,时间,预估净值,昨收净值,…,预估涨跌幅%,日期,…";（GBK 编码，仅取数字字段），
// 归一化为 {gsz, gszzl, dwjz, gztime}；远端失败/超时/无估值返回 null。
import type { FetchLike } from './search.ts';

const ESTIMATE_URL = 'https://hq.sinajs.cn/rn=';
const TIMEOUT_MS = 5000;

export interface FundEstimate {
  /** 预估净值 */
  gsz: number;
  /** 预估涨跌幅（%，相对昨收） */
  gszzl: number;
  /** 最新净值（盘中语义即昨收） */
  dwjz: number;
  /** 估值时间 YYYY-MM-DD HH:mm */
  gztime: string;
}

/** 解析新浪 fu_ 行情串；无估值（空串/占位）或结构非法返回 null。 */
export function normalizeEstimate(text: string): FundEstimate | null {
  const m = /^var hq_str_fu_\w+="([^"]*)";?\s*$/.exec(text.trim());
  if (!m) return null;
  const parts = (m[1] as string).split(',');
  // 字段位：1=估值时间(HH:mm:ss) 2=预估净值 3=最新净值(昨收) 6=预估涨跌幅% 7=日期
  if (parts.length < 8) return null;
  const gsz = Number(parts[2]);
  const dwjz = Number(parts[3]);
  const gszzl = Number(parts[6]);
  // 无估值时字段为空串（QDII 等）；数值须为正/有限
  if (!(gsz > 0) || !(dwjz > 0) || !Number.isFinite(gszzl)) return null;
  const date = parts[7] ?? '';
  const time = (parts[1] ?? '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return { gsz, gszzl, dwjz, gztime: `${date} ${time}` };
}

/** 拉取实时估值；远端失败/超时/无估值返回 null（路由层转 ok:false）。rn 防缓存参数须在 list 之前（新浪按最后一个参数名作变量名）。 */
export async function fetchEstimate(code: string, fetchImpl: FetchLike = fetch): Promise<FundEstimate | null> {
  const o = await fetchEstimateOutcome(code, fetchImpl);
  return o.kind === 'ok' ? o.est : null;
}

export type EstimateOutcome =
  | { kind: 'ok'; est: FundEstimate }
  /** 无盘中估值（QDII 等，或响应结构异常） */
  | { kind: 'none' }
  /** 网络失败/超时/HTTP 非 200 */
  | { kind: 'fail' };

/** 同 fetchEstimate，但区分「无估值」与「抓取失败」（固化调度据此决定当日跳过还是稍后重试）。 */
export async function fetchEstimateOutcome(code: string, fetchImpl: FetchLike = fetch): Promise<EstimateOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${ESTIMATE_URL}${Date.now()}&list=fu_${encodeURIComponent(code)}`, {
      signal: ctrl.signal,
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    if (!res.ok) return { kind: 'fail' };
    const est = normalizeEstimate(await res.text());
    return est ? { kind: 'ok', est } : { kind: 'none' };
  } catch {
    return { kind: 'fail' };
  } finally {
    clearTimeout(timer);
  }
}
