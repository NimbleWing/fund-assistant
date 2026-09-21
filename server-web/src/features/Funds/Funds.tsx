// 基金搜索页：代码/名称实时模糊搜索（server 代理天天基金 suggest）。
// 防抖 300ms；竞态用 AbortController + 序号双重保护：新输入 abort 旧请求，
// 旧响应即便侥幸返回也会因序号过期被丢弃，不会覆盖新结果。
// 结果行支持关注/取消关注（状态来自进入页面时拉取的关注列表）。
import { useEffect, useRef, useState } from 'react';
import { followFund, searchFunds, unfollowFund, fetchWatchlist, type FundHit, type WatchRow } from '@/lib/api';

interface FundsProps {
  /** 防抖毫秒数（测试注入 0） */
  debounceMs?: number;
}

type SearchState = 'idle' | 'loading' | 'done' | 'error';

export function Funds({ debounceMs = 300 }: FundsProps) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>('idle');
  const [hits, setHits] = useState<FundHit[]>([]);
  const [watched, setWatched] = useState<Map<string, WatchRow>>(new Map());
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const seqRef = useRef(0);

  // 进入页面拉一次关注列表，用于结果行「已关注」标记
  useEffect(() => {
    void fetchWatchlist().then((d) => {
      if (d?.ok && d.rows) setWatched(new Map(d.rows.map((r) => [r.code, r])));
    });
  }, []);

  useEffect(() => {
    const keyword = q.trim();
    if (!keyword) {
      seqRef.current += 1;
      setState('idle');
      setHits([]);
      return;
    }
    setState('loading');
    const ctrl = new AbortController();
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void searchFunds(keyword, ctrl.signal).then((data) => {
        if (seq !== seqRef.current) return; // 过期响应丢弃
        if (data == null || !data.ok) {
          setState('error');
          setHits([]);
          return;
        }
        setHits(data.hits ?? []);
        setState('done');
      });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, debounceMs]);

  const toggleWatch = async (h: FundHit) => {
    if (pendingCode) return;
    setPendingCode(h.code);
    try {
      if (watched.has(h.code)) {
        const d = await unfollowFund(h.code);
        if (d?.ok) {
          setWatched((prev) => {
            const next = new Map(prev);
            next.delete(h.code);
            return next;
          });
        }
      } else {
        const d = await followFund({ code: h.code, name: h.name, type: h.type });
        if (d?.ok && d.row) setWatched((prev) => new Map(prev).set(h.code, d.row as WatchRow));
      }
    } finally {
      setPendingCode(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <label htmlFor="fund-keyword" className="text-[13px] text-dim">
          基金代码 / 名称
        </label>
        <input
          id="fund-keyword"
          type="search"
          className="w-64"
          placeholder="如 001003 或 华夏"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <span className="text-xs text-dim">
          {state === 'loading' && '搜索中…'}
          {state === 'done' && `${hits.length} 条结果`}
          {state === 'error' && <span className="text-err">搜索服务暂不可用，请稍后重试</span>}
        </span>
      </div>

      {state === 'done' && hits.length === 0 && <p className="text-sm text-dim">无匹配基金，换个关键词试试。</p>}

      {hits.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => {
                const isWatched = watched.has(h.code);
                return (
                  <tr key={h.code}>
                    <td>{h.code}</td>
                    <td>{h.name}</td>
                    <td className="text-dim">{h.type ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className={isWatched ? 'act' : 'act act-primary'}
                        disabled={pendingCode === h.code}
                        title={isWatched ? '点击取消关注' : '加入关注列表'}
                        onClick={() => void toggleWatch(h)}
                      >
                        {isWatched ? '已关注' : '关注'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
