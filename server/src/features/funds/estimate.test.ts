// estimate 单测：新浪 fu_ 行情串解析归一化、无估值/非法结构返回 null、远端失败归一为 null（fetch 注入 stub）。
import { describe, expect, it, vi } from 'vitest';
import { fetchEstimate, normalizeEstimate } from './estimate.ts';
import type { FetchLike } from './search.ts';

const GZ_TEXT = 'var hq_str_fu_018994="中欧数字经济混合发起C,14:30:00,3.7500,3.7220,3.7220,0,0.75,2026-09-22,3.7922,1.8861";';

function stubFetch(text: string, ok = true): FetchLike {
  return vi.fn(async () => ({ ok, json: async () => ({}), text: async () => text }));
}

describe('normalizeEstimate', () => {
  it('解析 fu_ 行情串，数值转 number，gztime 拼接日期与时间', () => {
    expect(normalizeEstimate(GZ_TEXT)).toEqual({ gsz: 3.75, gszzl: 0.75, dwjz: 3.722, gztime: '2026-09-22 14:30' });
  });

  it('无估值（字段为空串，QDII 等）返回 null', () => {
    expect(normalizeEstimate('var hq_str_fu_000001="";')).toBeNull();
    expect(normalizeEstimate('var hq_str_fu_000001="某某QDII,,,,,,,";')).toBeNull();
  });

  it('非法结构返回 null', () => {
    expect(normalizeEstimate('')).toBeNull();
    expect(normalizeEstimate('var hq_str_fu_018994=abc;')).toBeNull();
    expect(normalizeEstimate('var hq_str_fu_018994="名称,14:30:00,0,3.7220,3.7220,0,0,2026-09-22";')).toBeNull();
    expect(normalizeEstimate('var hq_str_fu_018994="名称,14:30,3.75,3.722,3.722,0,0.75,not-a-date";')).toBeNull();
  });
});

describe('fetchEstimate', () => {
  it('正常返回归一化估值，code 编码进 URL 且带 Referer 头', async () => {
    const f = stubFetch(GZ_TEXT);
    expect(await fetchEstimate('018994', f)).toMatchObject({ gsz: 3.75, gszzl: 0.75 });
    const call = vi.mocked(f).mock.calls[0];
    expect(call?.[0]).toMatch(/rn=\d+&list=fu_018994$/);
    expect(call?.[1]?.headers?.Referer).toBe('https://finance.sina.com.cn');
  });

  it('远端非 2xx → null', async () => {
    expect(await fetchEstimate('018994', stubFetch(GZ_TEXT, false))).toBeNull();
  });

  it('fetch 抛错（超时/断网）→ null', async () => {
    const f: FetchLike = async () => {
      throw new Error('aborted');
    };
    expect(await fetchEstimate('018994', f)).toBeNull();
  });
});
