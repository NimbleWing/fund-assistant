// 大盘行情：上证指数 + 开休市状态（服务端按本地时间计算）；服务不可达/远端失败返回 null（面板隐藏该行）。
import { SERVER_ORIGIN } from './config.ts';
import { getJson } from './http.ts';

export interface MarketIndex {
  name: string;
  /** 最新点位 */
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅（%） */
  changePct: number;
  /** 是否开盘中 */
  open: boolean;
  /** 开休市文案（开盘中/休市） */
  label: string;
}

interface MarketResp {
  ok: boolean;
  index?: { name: string; price: number; change: number; changePct: number } | null;
  market?: { open: boolean; label: string };
}

/** 拉取大盘行情；服务不可达/远端失败返回 null。 */
export async function fetchMarketIndex(
  fetchImpl: typeof fetch = fetch,
  origin: string = SERVER_ORIGIN,
  timeoutMs = 5000,
): Promise<MarketIndex | null> {
  try {
    const r = await getJson<MarketResp>(fetchImpl, `${origin}/api/market/index`, timeoutMs);
    if (!r.ok || !r.index || !r.market) return null;
    const { name, price, change, changePct } = r.index;
    return { name, price, change, changePct, open: r.market.open, label: r.market.label };
  } catch {
    return null;
  }
}
