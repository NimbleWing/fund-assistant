// 大盘行情聚合单测：服务不可达/ok:false/缺字段 → null；正常路径展开 index + market。
import { describe, expect, it, vi } from 'vitest';
import { fetchMarketIndex } from '../../src/core/market.ts';

function stubFetch(body: unknown | null): typeof fetch {
  return vi.fn(async () => {
    if (body === null) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

const RESP = {
  ok: true,
  index: { code: 'sh000001', name: '上证指数', price: 3958.6395, change: 8.7327, changePct: 0.22 },
  market: { open: true, label: '开盘中' },
};

describe('fetchMarketIndex', () => {
  it('正常路径：index + market 展开', async () => {
    expect(await fetchMarketIndex(stubFetch(RESP))).toEqual({
      name: '上证指数',
      price: 3958.6395,
      change: 8.7327,
      changePct: 0.22,
      open: true,
      label: '开盘中',
    });
  });

  it('服务不可达（fetch 抛错）→ null', async () => {
    expect(await fetchMarketIndex(stubFetch(null))).toBeNull();
  });

  it('ok:false（远端行情失败）→ null', async () => {
    expect(await fetchMarketIndex(stubFetch({ ok: false, index: null, market: { open: false, label: '休市' } }))).toBeNull();
  });

  it('缺 market 字段 → null', async () => {
    expect(await fetchMarketIndex(stubFetch({ ok: true, index: RESP.index }))).toBeNull();
  });
});
