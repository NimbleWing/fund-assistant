// 关注列表页：已关注基金表格（代码/名称/类型/关注时间）+ 取消关注。
// 取消为服务端软删除（active=0），成功后本地即时移除行；空态引导去基金搜索页。
import { useCallback, useEffect, useState } from 'react';
import { fetchWatchlist, unfollowFund, type WatchRow } from '@/lib/api';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

export function Watchlist() {
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const d = await fetchWatchlist();
    if (d?.ok && d.rows) {
      setRows(d.rows);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unfollow = async (code: string) => {
    if (pendingCode) return;
    setPendingCode(code);
    try {
      const d = await unfollowFund(code);
      if (d?.ok) setRows((prev) => prev?.filter((r) => r.code !== code) ?? prev);
    } finally {
      setPendingCode(null);
    }
  };

  if (failed) return <p className="text-sm text-err">关注列表加载失败，请确认本地服务在线。</p>;
  if (rows == null) return <p className="text-sm text-dim">加载中…</p>;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-dim">暂无关注基金——到「基金搜索」页搜索并点击「关注」。</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>类型</th>
                <th>关注时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-dim">{r.type ?? '—'}</td>
                  <td className="text-dim">{fmtTime(r.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="act"
                      disabled={pendingCode === r.code}
                      onClick={() => void unfollow(r.code)}
                    >
                      取消关注
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button type="button" className="act" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
    </div>
  );
}
