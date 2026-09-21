import { useEffect, useMemo, useState } from 'react';
import type { TimelineStep } from '@/lib/api';
import { fmt, fmt4, pnlValue } from '@/lib/format';

// 过程回放走势图：净值折线 + 摊薄均价虚线（买入摊低/摊高，卖出不变），
// 买 ▲ 红 / 卖 ▼ 绿；当前步右侧淡出，光标竖线定位。
const W = 840;
const H = 240;
const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;

export function TimelineChart({ steps, idx }: { steps: TimelineStep[]; idx: number }) {
  const geo = useMemo(() => {
    const navs = steps.map((s) => s.nav);
    const avgs = steps.map((s) => s.avgPrice).filter((v): v is number => v != null);
    const min = Math.min(...navs, ...avgs);
    const max = Math.max(...navs, ...avgs);
    const span = max - min || 1;
    const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
    const x = (i: number) =>
      steps.length > 1 ? PAD_L + (i / (steps.length - 1)) * (W - PAD_L - PAD_R) : (W + PAD_L - PAD_R) / 2;
    return { min, max, x, y };
  }, [steps]);

  if (steps.length === 0) return null;
  const { min, max, x, y } = geo;

  const path = (from: number, to: number, getV: (s: TimelineStep) => number | null): string => {
    const pts: string[] = [];
    for (let i = from; i <= to; i++) {
      const v = getV(steps[i]);
      if (v == null) continue;
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
    return pts.join(' ');
  };

  // 均价线按连续非 null 段绘制（清仓后再买入会产生断档）
  const avgSegs: [number, number][] = [];
  let segStart = -1;
  steps.forEach((s, i) => {
    if (s.avgPrice != null && segStart === -1) segStart = i;
    if ((s.avgPrice == null || i === steps.length - 1) && segStart !== -1) {
      avgSegs.push([segStart, s.avgPrice == null ? i - 1 : i]);
      segStart = -1;
    }
  });

  const navOf = (s: TimelineStep) => s.nav;
  const avgOf = (s: TimelineStep) => s.avgPrice;
  const cursorX = x(idx);
  const cursorLabel = steps[idx]?.time ?? '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="净值与摊薄均价走势">
      {/* 网格与刻度 */}
      {[max, (max + min) / 2, min].map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={i === 1 ? '4 4' : undefined} opacity="0.6" />
          <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--color-dim)">
            {fmt4(v).replace(/0+$/, '').replace(/\.$/, '')}
          </text>
        </g>
      ))}

      {/* 未来部分（淡） */}
      {idx < steps.length - 1 && (
        <>
          <path d={path(idx, steps.length - 1, navOf)} fill="none" stroke="var(--color-dim)" strokeWidth="1.5" opacity="0.25" />
          {avgSegs.map(([a, b], i) =>
            idx < b ? <path key={i} d={path(Math.max(idx, a), b, avgOf)} fill="none" stroke="var(--color-brand)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.25" /> : null,
          )}
        </>
      )}

      {/* 已走到部分 */}
      <path d={path(0, idx, navOf)} fill="none" stroke="var(--color-ink)" strokeWidth="1.8" />
      {avgSegs.map(([a, b], i) =>
        idx >= a ? <path key={i} d={path(a, Math.min(idx, b), avgOf)} fill="none" stroke="var(--color-brand)" strokeWidth="1.8" strokeDasharray="5 4" /> : null,
      )}

      {/* 买 ▲ / 卖 ▼ */}
      {steps.map((s, i) => {
        const dim = i > idx ? 0.25 : 1;
        const cy = y(s.nav);
        if (s.isSell) {
          return <path key={i} d={`M${x(i).toFixed(1)},${(cy - 3).toFixed(1)}l3.4,6h-6.8z`} fill="var(--color-down)" opacity={dim} />;
        }
        return <path key={i} d={`M${x(i).toFixed(1)},${(cy + 3).toFixed(1)}l3.4,-6h-6.8z`} fill="var(--color-up)" opacity={dim} />;
      })}

      {/* 光标 */}
      <line x1={cursorX} x2={cursorX} y1={PAD_T} y2={H - PAD_B} stroke="var(--color-brand)" strokeWidth="1" opacity="0.8" />
      <text x={Math.min(Math.max(cursorX, PAD_L + 18), W - PAD_R - 18)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-dim)">
        {cursorLabel}
      </text>
    </svg>
  );
}
