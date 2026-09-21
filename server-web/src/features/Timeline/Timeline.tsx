import { useCallback, useEffect, useState } from 'react';
import { fetchRecords } from '@/lib/api';
import { fmt, fmt4, pnlValue } from '@/lib/format';
import { TimelineChart } from './TimelineChart';

// 过程回放：从第一笔到最新一笔逐笔回放摊薄口径状态变化
// （累计投入/摊薄成本/份额/均价/累计回款/累计已实现盈亏）。
const SPEEDS = [
  { label: '0.5×', ms: 1400 },
  { label: '1×', ms: 700 },
  { label: '2×', ms: 350 },
];

/** 状态数值卡（label + 值 + 可选配色类）。 */
function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[13px] text-dim">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${cls ?? ''}`}>{value}</p>
    </div>
  );
}

export function Timeline() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchRecords>>>();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(700);

  const refresh = useCallback(async () => {
    setData(await fetchRecords());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const steps = data?.ok ? data.timeline : [];
  const last = steps.length - 1;

  // 自动播放：到末步停止
  useEffect(() => {
    if (!playing || steps.length === 0) return;
    const n = steps.length;
    const timer = setInterval(() => setIdx((i) => Math.min(i + 1, n - 1)), speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, steps.length]);

  useEffect(() => {
    if (steps.length > 0 && idx >= steps.length - 1) setPlaying(false);
  }, [idx, steps.length]);

  if (!data) {
    return <p className="text-sm text-dim">加载中…</p>;
  }
  if (!data.ok) {
    return <p className="text-sm text-err">{data.error ?? '数据加载失败'}</p>;
  }
  if (steps.length === 0) {
    return <p className="text-sm text-dim">无交易记录</p>;
  }

  const cur = steps[Math.min(idx, last)];
  if (!cur) return null;
  const stepPnl = pnlValue(cur.stepPnl);
  const realized = pnlValue(cur.realizedPnl);

  const togglePlay = () => {
    if (!playing && idx >= last) setIdx(0); // 在末步按下播放 → 从头回放
    setPlaying((v) => !v);
  };
  const jump = (to: number) => {
    setPlaying(false);
    setIdx(to);
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* 播放器 */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-1.5">
          <button type="button" className="act" aria-label="首笔" onClick={() => jump(0)}>
            ⏮
          </button>
          <button type="button" className="act" aria-label="上一笔" disabled={idx <= 0} onClick={() => jump(Math.max(0, idx - 1))}>
            ◀
          </button>
          <button type="button" className="act act-primary" aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button type="button" className="act" aria-label="下一笔" disabled={idx >= last} onClick={() => jump(Math.min(last, idx + 1))}>
            ▶
          </button>
          <button type="button" className="act" aria-label="末笔" onClick={() => jump(last)}>
            ⏭
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="chip"
              aria-pressed={speedMs === s.ms}
              onClick={() => setSpeedMs(s.ms)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          aria-label="进度"
          className="min-w-40 flex-1"
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
        />
        <span className="shrink-0 text-[13px] tabular-nums text-dim">
          {idx + 1} / {steps.length}
        </span>
      </div>

      {/* 当前笔 */}
      <div className="card flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
        <span className="text-lg font-semibold">
          第 {cur.seq} 笔 · <span className={cur.isSell ? 'text-down' : 'text-up'}>{cur.isSell ? '卖出' : '买入'}</span> {cur.time}
        </span>
        {cur.isSell ? (
          <span className="text-[13px] text-dim">
            回款 <b className="text-ink tabular-nums">{fmt(cur.amount)}</b> · 卖出净值 {fmt4(cur.nav)} · {fmt(cur.shares)} 份 · 本笔盈亏{' '}
            <b className={`tabular-nums ${stepPnl.cls}`}>{stepPnl.text}</b>
          </span>
        ) : (
          <span className="text-[13px] text-dim">
            本金 <b className="text-ink tabular-nums">{fmt(cur.amount)}</b> · 确认净值 {fmt4(cur.nav)} · 得 {fmt(cur.shares)} 份
          </span>
        )}
      </div>

      {/* 状态卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="累计投入" value={fmt(cur.invested)} />
        <Stat label="摊薄成本" value={fmt(cur.cost)} />
        <Stat label="持仓份额" value={fmt(cur.holdingShares)} />
        <Stat label="摊薄均价" value={cur.avgPrice != null ? fmt4(cur.avgPrice) : '—'} />
        <Stat label="累计回款" value={fmt(cur.proceeds)} />
        <Stat label="累计已实现" value={realized.text} cls={realized.cls} />
      </div>

      {/* 走势图 */}
      <div className="card p-2 pt-3">
        <TimelineChart steps={steps} idx={idx} />
        <p className="px-3 pb-1 text-xs text-dim">
          白线 净值 · <span className="text-brand">虚线 摊薄均价</span> · <span className="text-up">▲ 买入</span> · <span className="text-down">▼ 卖出</span>
        </p>
      </div>

      <div>
        <button type="button" className="act" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
    </div>
  );
}
