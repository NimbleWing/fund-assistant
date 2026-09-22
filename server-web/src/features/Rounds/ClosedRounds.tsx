// 已清仓轮次页：历史轮次表（清仓快照直接读库）+ 展开交易明细。
import { Fragment, useCallback, useEffect, useState } from 'react';
import { MetricTip } from '@/components/MetricTip';
import { fetchRounds, type RoundData } from '@/lib/api';
import { fmt, fmt4, pctValue, pnlValue } from '@/lib/format';
import { METRIC_FORMULAS } from '@/lib/formulas';
import { useFundSelection } from './useFundSelection';

export function ClosedRounds() {
  const { funds, fundCode, setFundCode } = useFundSelection();
  const [rounds, setRounds] = useState<RoundData[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!fundCode) {
      setRounds([]);
      return;
    }
    const d = await fetchRounds(fundCode);
    if (d?.ok && d.rounds) {
      setRounds(d.rounds.filter((r) => r.status === 'closed'));
      setError('');
    } else {
      setError(d?.error ?? '轮次加载失败，请确认服务在线');
    }
  }, [fundCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <label htmlFor="closed-rounds-fund" className="text-[13px] text-dim">
          基金
        </label>
        <select id="closed-rounds-fund" value={fundCode} onChange={(e) => setFundCode(e.target.value)}>
          {funds.length === 0 && <option value="">（先去关注基金）</option>}
          {funds.map((f) => (
            <option key={f.code} value={f.code}>
              {f.name} {f.code}
            </option>
          ))}
        </select>
        <button type="button" className="act" onClick={() => void refresh()}>
          刷新
        </button>
        {error && <span className="text-xs text-err">{error}</span>}
      </div>

      {rounds != null && rounds.length === 0 && fundCode && (
        <p className="text-sm text-dim">暂无已清仓轮次——在「当前轮次」页清仓闭轮后会出现在这里。</p>
      )}

      {rounds != null && rounds.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                <th>轮次</th>
                <th>状态</th>
                <th><MetricTip label="买入次数" tip={METRIC_FORMULAS.buyCount} /></th>
                <th><MetricTip label="卖出次数" tip={METRIC_FORMULAS.sellCount} /></th>
                <th><MetricTip label="总投入" tip={METRIC_FORMULAS.invested} /></th>
                <th><MetricTip label="累计回款" tip={METRIC_FORMULAS.proceeds} /></th>
                <th><MetricTip label="已实现盈亏" tip={METRIC_FORMULAS.realizedPnl} /></th>
                <th><MetricTip label="已卖本金" tip={METRIC_FORMULAS.soldPrincipal} /></th>
                <th><MetricTip label="轮总盈亏" tip={METRIC_FORMULAS.totalPnl} /></th>
                <th><MetricTip label="轮总盈亏率" tip={METRIC_FORMULAS.totalPnl} /></th>
                <th>闭轮时间</th>
                <th>明细</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <Fragment key={r.id}>
                  <tr>
                    <td>第 {r.seq} 轮</td>
                    <td>
                      <span className="badge badge-dim">已清仓</span>
                    </td>
                    <td>{r.metrics.buyCount}</td>
                    <td>{r.metrics.sellCount}</td>
                    <td>{fmt(r.metrics.invested)}</td>
                    <td>{fmt(r.metrics.proceeds)}</td>
                    <td className={pnlValue(r.metrics.realizedPnl).cls}>{pnlValue(r.metrics.realizedPnl).text}</td>
                    <td>{fmt(r.metrics.soldPrincipal)}</td>
                    <td className={`font-semibold ${pnlValue(r.metrics.totalPnl ?? 0).cls}`}>{pnlValue(r.metrics.totalPnl ?? 0).text}</td>
                    <td className={r.metrics.totalPnlPct != null ? pctValue(r.metrics.totalPnlPct).cls : ''}>
                      {r.metrics.totalPnlPct != null ? pctValue(r.metrics.totalPnlPct).text : '—'}
                    </td>
                    <td className="text-dim">{r.closedAt ? new Date(r.closedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                    <td>
                      <button type="button" className="act" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? '收起' : '展开'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={12}>
                        <table className="tabular-nums">
                          <tbody>
                            {r.txns.map((t) => (
                              <tr key={t.id}>
                                <td className={t.direction === 'buy' ? 'text-up' : 'text-down'}>{t.direction === 'buy' ? '买入' : '卖出'}</td>
                                <td>{t.date}</td>
                                <td>{fmt(t.amount)}</td>
                                <td>{fmt4(t.nav)}</td>
                                <td>{fmt(t.shares)}</td>
                                <td>{t.direction === 'sell' && t.fee > 0 ? `手续费 ${fmt(t.fee)}` : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
