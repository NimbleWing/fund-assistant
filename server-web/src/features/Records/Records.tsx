import { useCallback, useEffect, useState } from 'react';
import { fetchRecords, type RecordsData, type PairRow } from '@/lib/api';

// 临时分析页：买卖记录配对表（数据由 server 解析 buyAndSellRecord.txt）。
// 颜色遵循 A 股习惯：红盈绿亏（up/down 主题令牌）；持有行卖出三列显示 —。
function fmt(n: number): string {
  return n.toFixed(2);
}

function pnlCell(row: PairRow): { text: string; cls: string } {
  if (row.pnl == null) return { text: '持有中', cls: 'text-dim' };
  if (row.pnl > 0) return { text: `+${fmt(row.pnl)}`, cls: 'text-up font-semibold' };
  if (row.pnl < 0) return { text: fmt(row.pnl), cls: 'text-down font-semibold' };
  return { text: '0.00', cls: 'text-dim' };
}

export function Records() {
  const [data, setData] = useState<RecordsData | null>(null);

  const refresh = useCallback(async () => {
    setData(await fetchRecords());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) {
    return <p className="text-sm text-dim">加载中…</p>;
  }
  if (!data.ok) {
    return <p className="text-sm text-err">{data.error ?? '数据加载失败'}</p>;
  }

  const pnlCls = data.realizedPnl > 0 ? 'text-up' : data.realizedPnl < 0 ? 'text-down' : 'text-ink';

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[13px] text-dim">已实现盈亏</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${pnlCls}`}>
            {data.realizedPnl > 0 ? '+' : ''}
            {fmt(data.realizedPnl)}
          </p>
          <p className="mt-1 text-xs text-dim">已卖本金 {fmt(data.soldPrincipal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-dim">持有本金</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(data.holdingPrincipal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[13px] text-dim">持有份额</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{fmt(data.holdingShares)}</p>
        </div>
      </div>

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
