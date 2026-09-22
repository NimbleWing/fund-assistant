// market/quote 单测：s_ 行情串解析归一化、非法结构返回 null、远端失败归一为 null（fetch 注入 stub）。
import { describe, expect, it, vi } from 'vitest';
import { fetchIndexQuote, normalizeIndexQuote } from './quote.ts';
import type { FetchLike } from '../funds/search.ts';

const QUOTE_TEXT = 'var hq_str_s_sh000001="上证指数,3958.6395,8.7327,0.22,3300438,68103467";';

function stubFetch(text: string, ok = true): FetchLike {
  return vi.fn(async () => ({ ok, json: async () => ({}), text: async () => text }));
}

describe('normalizeIndexQuote', () => {
  it('解析 s_ 行情串，数值转 number', () => {
    expect(normalizeIndexQuote('sh000001', QUOTE_TEXT)).toEqual({
      code: 'sh000001',
      price: 3958.6395,
      change: 8.7327,
      changePct: 0.22,
    });
  });

  it('非法结构/数值返回 null', () => {
    expect(normalizeIndexQuote('sh000001', '')).toBeNull();
    expect(normalizeIndexQuote('sh000001', 'var hq_str_s_sh000001="";')).toBeNull();
    expect(normalizeIndexQuote('sh000001', 'var hq_str_s_sh000001="上证指数,0,0,0";')).toBeNull();
    expect(normalizeIndexQuote('sh000001', 'var hq_str_s_sh000001="上证指数,abc";')).toBeNull();
  });
});

describe('fetchIndexQuote', () => {
  it('正常返回行情，code 编码进 URL 且带 Referer 头', async () => {
    const f = stubFetch(QUOTE_TEXT);
    expect(await fetchIndexQuote('sh000001', f)).toMatchObject({ price: 3958.6395, changePct: 0.22 });
    const call = vi.mocked(f).mock.calls[0];
    expect(call?.[0]).toMatch(/rn=\d+&list=s_sh000001$/);
    expect(call?.[1]?.headers?.Referer).toBe('https://finance.sina.com.cn');
  });

  it('远端非 2xx → null', async () => {
    expect(await fetchIndexQuote('sh000001', stubFetch(QUOTE_TEXT, false))).toBeNull();
  });

  it('fetch 抛错（超时/断网）→ null', async () => {
    const f: FetchLike = async () => {
      throw new Error('aborted');
    };
    expect(await fetchIndexQuote('sh000001', f)).toBeNull();
  });
});
