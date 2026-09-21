import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRecords, type RecordsData, type PairRow } from '@/lib/api';

// 临时分析页：买卖记录配对表（数据由 server 解析 buyAndSellRecord.txt）。
// 双口径：逐笔配对（已实现/浮动分开）+ 摊薄成本（对齐基金 App「持仓收益」，已实现滚入成本）。
// 颜色遵循 A 股习惯：红盈绿亏（up/down 主题令牌）；持有行卖出三列显示 —。

const NAV_KEY = 'records-latest-nav';

function fmt(n: number): string {
  return n.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 带符号金额；正红负绿零灰 */
function pnlValue(v: number): { text: string; cls: string } {
  if (v > 0) return { text: `+${fmt(v)}`, cls: 'text-up' };
  if (v < 0) return { text: fmt(v), cls: 'text-down' };
  return { text: '0.00', cls: 'text-dim' };
}

function pnlCell(row: PairRow): { text: string; cls: string } {
  if (row.pnl == null) return { text: '持有中', cls: 'text-dim' };
  if (row.pnl > 0) return { text: `+${fmt(row.pnl)}`, cls: 'text-up font-semibold' };
  if (row.pnl < 0) return { text: fmt(row.pnl), cls: 'text-down font-semibold' };
  return { text: '0.00', cls: 'text-dim' };
}

export function Records() {
  const [data, setData] = useState<RecordsData | null>(null);
  const [navText, setNavText] = useState('');
  const navInit = useRef(false);

  const refresh = useCallback(async () => {
    setData(await fetchRecords());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 最新净值默认值：上次输入（localStorage）→ 最后一条卖出净值 → 空
  useEffect(() => {
    if (navInit.current || data?.ok !== true) return;
    navInit.current = true;
    const saved = localStorage.getItem(NAV_KEY);
    setNavText(saved ?? (data.latestSellNav != null ? String(data.latestSellNav) : ''));
  }, [data]);

  if (!data) {
    return <p className="text-sm text-dim">加载中…</p>;
  }
  if (!data.ok) {
    return <p className="text-sm text-err">{data.error ?? '数据加载失败'}</p>;
  }

  const nav = Number(navText);
  const hasNav = Number.isFinite(nav) && nav > 0;
  const marketValue = hasNav ? round2(nav * data.holdingShares) : null;
  const dilutedPnl = marketValue != null ? round2(marketValue - data.diluted.cost) : null;
  const floatingPnl = marketValue != null ? round2(marketValue - data.holdingPrincipal) : null;
  const accountPnl = marketValue != null ? round2(marketValue + data.sellProceeds - data.totalBuyPrincipal) : null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[13px] text-dim">已实现盈亏 · 逐笔配对</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${pnlValue(data.realizedPnl).cls}`}>
            {pnlValue(data.realizedPnl).text}
          </p>
          <p className="mt-1 text-xs text-dim">已卖本金 {fmt(data.soldPrincipal)} · 摊薄口径 {pnlValue(data.diluted.realizedPnl).text}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-dim">持有本金 · 逐笔配对</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(data.holdingPrincipal)}</p>
          <p className="mt-1 text-xs text-dim">摊薄持仓成本 {fmt(data.diluted.cost)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-dim">持有份额</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(data.holdingShares)}</p>
          <p className="mt-1 text-xs text-dim">
            {data.diluted.costPrice != null ? `摊薄成本价 ${data.diluted.costPrice.toFixed(4)}` : '无持仓'}
          </p>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <label htmlFor="latest-nav" className="text-[13px] text-dim">
          最新净值
        </label>
        <input
          id="latest-nav"
          type="number"
          step="0.0001"
          min="0"
          className="w-28"
          value={navText}
          onChange={(e) => {
            setNavText(e.target.value);
            try {
              localStorage.setItem(NAV_KEY, e.target.value);
            } catch {
              // localStorage 不可用时仅内存态
            }
          }}
        />
        {marketValue != null && (
          <span className="text-[13px] text-dim">
            持仓市值 <b className="text-ink tabular-nums">{fmt(marketValue)}</b>
          </span>
        )}
        {data.diluted.costPrice != null && data.accountBreakEvenNav != null && (
          <span className="ml-auto text-xs text-dim">
            回本净值：摊薄口径 {data.diluted.costPrice.toFixed(4)} · 账户回本 {data.accountBreakEvenNav.toFixed(4)}
          </span>
        )}
      </div>

      {hasNav && marketValue != null && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-[13px] text-dim">持仓收益 · 摊薄（App 口径）</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${dilutedPnl != null ? pnlValue(dilutedPnl).cls : ''}`}>
              {dilutedPnl != null ? pnlValue(dilutedPnl).text : '—'}
            </p>
            <p className="mt-1 text-xs text-dim">市值 − 摊薄成本</p>
          </div>
          <div className="card p-4">
            <p className="text-[13px] text-dim">浮动盈亏 · 逐笔配对</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${floatingPnl != null ? pnlValue(floatingPnl).cls : ''}`}>
              {floatingPnl != null ? pnlValue(floatingPnl).text : '—'}
            </p>
            <p className="mt-1 text-xs text-dim">市值 − 持有本金</p>
          </div>
          <div className="card p-4">
            <p className="text-[13px] text-dim">账户总盈亏</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${accountPnl != null ? pnlValue(accountPnl).cls : ''}`}>
              {accountPnl != null ? pnlValue(accountPnl).text : '—'}
            </p>
            <p className="mt-1 text-xs text-dim">市值 + 累计回款 − 总投入</p>
          </div>
          <div className="card p-4">
            <p className="text-[13px] text-dim">总投入 / 累计回款</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(data.totalBuyPrincipal)}</p>
            <p className="mt-1 text-xs text-dim">回款 {fmt(data.sellProceeds)}</p>
          </div>
        </div>
      )}

      {data.anomalies.length > 0 && (
        <p className="badge badge-warn text-[13px] leading-relaxed">
          {data.anomalies.length} 条买入份额与 本金÷净值 偏差过大：
          {data.anomalies.map((a) => `${a.time} 份额 ${a.shares}（按本金/净值应为 ${a.expectedShares}）`).join('、')}
        </p>
      )}

      {data.unmatchedSells.length > 0 && (
        <p className="badge badge-warn text-[13px] leading-relaxed">
          {data.unmatchedSells.length} 条卖出未找到同份额买入：{data.unmatchedSells.map((s) => `${s.time}（${s.shares} 份）`).join('、')}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="tabular-nums">
          <thead>
            <tr>
              <th>买入时间</th>
              <th>本金</th>
              <th>确认净值</th>
              <th>确认份额</th>
              <th>卖出时间</th>
              <th>卖出净值</th>
              <th>盈亏</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => {
              const pnl = pnlCell(row);
              const holding = row.sellTime == null;
              return (
                <tr key={i} className={holding ? 'opacity-70' : ''}>
                  <td>{row.buyTime}</td>
                  <td>{fmt(row.principal)}</td>
                  <td>{row.buyNav.toFixed(4)}</td>
                  <td>{fmt(row.shares)}</td>
                  <td className={holding ? 'text-dim' : ''}>{row.sellTime ?? '—'}</td>
                  <td className={holding ? 'text-dim' : ''}>{row.sellNav != null ? row.sellNav.toFixed(4) : '—'}</td>
                  <td className={pnl.cls}>{pnl.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <button type="button" className="act" onClick={() => void refresh()}>
          刷新
        </button>
      </div>
    </div>
  );
}
