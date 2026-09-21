// searchFunds 单测：归一化、空关键词、上限截断、远端失败/超时归一为 null（fetch 注入 stub）。
import { describe, expect, it, vi } from 'vitest';
import { normalizeSuggest, searchFunds, type FetchLike } from './search.ts';

const SUGGEST_BODY = {
  ErrCode: 0,
  Datas: [
    { CODE: '001003', NAME: '华夏债券C', FundBaseInfo: { FTYPE: '债券型-混合一级' } },
    { CODE: '000001', NAME: '华夏成长混合', FundBaseInfo: { FTYPE: '混合型-灵活' } },
  ],
};

function stubFetch(body: unknown, ok = true): FetchLike {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

describe('normalizeSuggest', () => {
  it('提取 code/name/type，FTYPE 缺失为 null', () => {
    const hits = normalizeSuggest({
      Datas: [{ CODE: '001003', NAME: '华夏债券C', FundBaseInfo: { FTYPE: '债券型-混合一级' } }, { CODE: '000002', NAME: '无类型基金' }],
    });
    expect(hits).toEqual([
      { code: '001003', name: '华夏债券C', type: '债券型-混合一级' },
      { code: '000002', name: '无类型基金', type: null },
    ]);
  });

  it('非法结构返回空列表', () => {
    expect(normalizeSuggest(null)).toEqual([]);
    expect(normalizeSuggest({})).toEqual([]);
    expect(normalizeSuggest({ Datas: 'x' })).toEqual([]);
    expect(normalizeSuggest({ Datas: [{ CODE: 1 }, null] })).toEqual([]);
  });

  it('上限截断 20 条', () => {
    const datas = Array.from({ length: 30 }, (_, i) => ({ CODE: String(i), NAME: `基金${i}` }));
    expect(normalizeSuggest({ Datas: datas })).toHaveLength(20);
  });
});

describe('searchFunds', () => {
  it('空关键词直接返回空列表（不打远端）', async () => {
    const f = stubFetch(SUGGEST_BODY);
    expect(await searchFunds('  ', f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('正常返回归一化结果，关键词编码进 URL', async () => {
    const f = stubFetch(SUGGEST_BODY);
    const hits = await searchFunds('华夏', f);
    expect(hits).toHaveLength(2);
    expect(hits?.[0]).toEqual({ code: '001003', name: '华夏债券C', type: '债券型-混合一级' });
    expect(vi.mocked(f).mock.calls[0]?.[0]).toContain(`key=${encodeURIComponent('华夏')}`);
  });

  it('远端非 2xx → null', async () => {
    expect(await searchFunds('华夏', stubFetch(SUGGEST_BODY, false))).toBeNull();
  });

  it('fetch 抛错（超时/断网）→ null', async () => {
    const f: FetchLike = async () => {
      throw new Error('aborted');
    };
    expect(await searchFunds('华夏', f)).toBeNull();
  });
});
