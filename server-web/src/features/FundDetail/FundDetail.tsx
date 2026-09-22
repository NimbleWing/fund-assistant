// 基金净值详情页（关注列表点击进入，非侧边栏页签）：净值历史表（含固化预估净值列）+ 手动补录表单。
// 补录与启动同步同一去重规则：已存在日期不覆盖，服务端返回 inserted:false，页面明确提示。
// 预估净值由服务端在交易日 16:00 后自动固化（fund_est_nav），与实际净值按日期合并展示。
import { useCallback, useEffect, useState } from 'react';
import { addFundNav, fetchFundNavs, type EstNavRow, type NavRow } from '@/lib/api';

interface FundDetailProps {
  fund: { code: string; name: string; type: string | null };
  onBack: () => void;
}

type Feedback = { kind: 'ok' | 'warn' | 'err'; text: string } | null;

/** 展示行：实际净值与固化预估净值按日期合并（并集）；仅预估无实际净值的日期也展示 */
interface ViewRow {
  date: string;
  unitNav: number | null;
  est: EstNavRow | null;
}

export function FundDetail({ fund, onBack }: FundDetailProps) {
  const [rows, setRows] = useState<NavRow[] | null>(null);
  const [estRows, setEstRows] = useState<EstNavRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [date, setDate] = useState('');
  const [navText, setNavText] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(0);

  const refresh = useCallback(async () => {
    const d = await fetchFundNavs(fund.code);
    if (d?.ok && d.rows) {
      setRows(d.rows);
      setEstRows(d.estRows ?? []);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, [fund.code]);

  useEffect(() => {
    void refresh();
    setPage(0);
  }, [refresh]);

  const viewRows: ViewRow[] = (() => {
    const map = new Map<string, ViewRow>();
    for (const r of rows ?? []) map.set(r.date, { date: r.date, unitNav: r.unitNav, est: null });
    for (const e of estRows) {
      const v = map.get(e.date);
      if (v) v.est = e;
      else map.set(e.date, { date: e.date, unitNav: null, est: e });
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  })();

  // 分页：客户端切片（全量已拉取，单基金历史量级 ~千条）
  const PAGE_SIZE = 50;
  const pageCount = viewRows.length > 0 ? Math.max(1, Math.ceil(viewRows.length / PAGE_SIZE)) : 1;
  const curPage = Math.min(page, pageCount - 1);
  const pageRows = viewRows.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE);
  const [jumpText, setJumpText] = useState('');

  const jumpTo = () => {
    const n = Number(jumpText);
    if (!Number.isInteger(n)) return;
    setPage(Math.min(Math.max(n, 1), pageCount) - 1);
    setJumpText('');
  };

  const submit = async () => {
    const unitNav = Number(navText);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setFeedback({ kind: 'err', text: '请选择净值日期（YYYY-MM-DD）' });
      return;
    }
    if (!Number.isFinite(unitNav) || unitNav <= 0) {
      setFeedback({ kind: 'err', text: '单位净值需为正数' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const d = await addFundNav(fund.code, date, unitNav);
      if (d == null || !d.ok) {
        setFeedback({ kind: 'err', text: d?.error ?? '补录失败，请确认服务在线' });
      } else if (d.inserted) {
        setFeedback({ kind: 'ok', text: `已补录 ${date} 单位净值 ${unitNav}` });
        setNavText('');
        await refresh();
      } else {
        setFeedback({ kind: 'warn', text: `${date} 已存在净值记录，未覆盖` });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <button type="button" className="act" onClick={onBack}>
          ← 返回关注列表
        </button>
        <p className="font-medium">
          {fund.name} <span className="text-dim">{fund.code}</span>
          {fund.type && <span className="ml-2 text-[13px] text-dim">{fund.type}</span>}
        </p>
        <span className="ml-auto text-xs text-dim">{rows != null ? `已录 ${rows.length} 条` : ''}</span>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <label htmlFor="nav-date" className="text-[13px] text-dim">
          净值日期
        </label>
        <input id="nav-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <label htmlFor="nav-value" className="text-[13px] text-dim">
          单位净值
        </label>
        <input
          id="nav-value"
          type="number"
          step="0.0001"
          min="0"
          className="w-28"
          value={navText}
          onChange={(e) => setNavText(e.target.value)}
        />
        <button type="button" className="act act-primary" disabled={submitting} onClick={() => void submit()}>
          补录
        </button>
        {feedback && (
          <span className={`text-xs ${feedback.kind === 'err' ? 'text-err' : feedback.kind === 'warn' ? 'text-warn' : 'text-ok'}`}>
            {feedback.text}
          </span>
        )}
      </div>

      {failed && <p className="text-sm text-err">净值历史加载失败，请确认本地服务在线。</p>}
      {!failed && rows == null && <p className="text-sm text-dim">加载中…</p>}
      {!failed && rows != null && viewRows.length === 0 && (
        <p className="text-sm text-dim">暂无净值记录——服务启动时会自动同步最近约一个月净值，更早历史可在上方补录。</p>
      )}
      {rows != null && viewRows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                <th>净值日期</th>
                <th>单位净值</th>
                <th>预估净值</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                // 预估偏差 =（预估 − 实际）/ 实际；两者都有时展示
                const dev = r.est != null && r.unitNav != null ? ((r.est.estimatedNav - r.unitNav) / r.unitNav) * 100 : null;
                return (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.unitNav != null ? r.unitNav.toFixed(4) : '—'}</td>
                    <td>
                      {r.est != null ? r.est.estimatedNav.toFixed(4) : '—'}
                      {dev != null && <span className="ml-1 text-xs text-dim">（偏差 {dev >= 0 ? '+' : ''}{dev.toFixed(2)}%）</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-surface px-4 py-2 text-[13px] text-dim">
              <button type="button" className="act" disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>
                上一页
              </button>
              <span className="tabular-nums">
                第 {curPage + 1} / {pageCount} 页
              </span>
              <button type="button" className="act" disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)}>
                下一页
              </button>
              <span className="ml-auto flex items-center gap-2">
                跳至
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  className="w-16"
                  value={jumpText}
                  placeholder={String(pageCount)}
                  aria-label="页码跳转"
                  onChange={(e) => setJumpText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') jumpTo();
                  }}
                />
                页
                <button type="button" className="act" onClick={jumpTo}>
                  跳转
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
