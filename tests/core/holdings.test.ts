// 持仓估值汇总单测：服务不可达 → null；无进行中轮/零持仓跳过；估值不可用时字段置 null；预估涨跌额计算。
import { describe, expect, it, vi } from 'vitest';
import { fetchHoldingEstimates } from '../../src/core/holdings.ts';

/** URL 路由 stub：按路径返回响应体（null = 抛错模拟网络失败）。 */
function stubFetch(map: Record<string, unknown | null>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [k, v] of Object.entries(map)) {
      if (!url.includes(k)) continue;
      if (v == null) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(v), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

const WATCH = { ok: true, rows: [{ code: '018994', name: '中欧数字经济混合发起C' }] };
const ROUNDS_HOLDING = { ok: true, rounds: [{ status: 'active', metrics: { holdingShares: 500 } }] };
const ESTIMATE = { ok: true, estimate: { gsz: 3.75, gszzl: 0.75, dwjz: 3.722, gztime: '2026-09-22 14:30' } };

describe('fetchHoldingEstimates', () => {
  it('服务不可达（watchlist 失败）→ null', async () => {
    expect(await fetchHoldingEstimates(stubFetch({ '/api/watchlist': null }))).toBeNull();
  });

  it('正常路径：预估涨跌额 = 持有份额 ×（预估净值 − 最新净值）', async () => {
    const rows = await fetchHoldingEstimates(stubFetch({ '/api/watchlist': WATCH, '/api/rounds': ROUNDS_HOLDING, '/estimate': ESTIMATE }));
    expect(rows).toHaveLength(1);
    // 500 × (3.75 − 3.722) = 14
    expect(rows?.[0]).toEqual({ code: '018994', name: '中欧数字经济混合发起C', shares: 500, estChangePct: 0.75, estChangeAmount: 14, gztime: '2026-09-22 14:30' });
  });

  it('无进行中轮或零持仓的基金跳过；无持仓时返回空列表', async () => {
    const rows = await fetchHoldingEstimates(
      stubFetch({ '/api/watchlist': WATCH, '/api/rounds': { ok: true, rounds: [{ status: 'closed', metrics: { holdingShares: 0 } }] }, '/estimate': ESTIMATE }),
    );
    expect(rows).toEqual([]);
  });

  it('估值不可用（远端失败）时该行保留、估值字段为 null', async () => {
    const rows = await fetchHoldingEstimates(stubFetch({ '/api/watchlist': WATCH, '/api/rounds': ROUNDS_HOLDING, '/estimate': null }));
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ code: '018994', shares: 500, estChangePct: null, estChangeAmount: null, gztime: null });
  });

  it('估值接口 ok:false（非交易时段）同上容忍', async () => {
    const rows = await fetchHoldingEstimates(stubFetch({ '/api/watchlist': WATCH, '/api/rounds': ROUNDS_HOLDING, '/estimate': { ok: false } }));
    expect(rows?.[0]?.estChangePct).toBeNull();
  });
});
