// 轮次页：基金选择（关注列表）+ 进行中轮卡片（指标动态计算）+ 买卖录入 + 历史轮次（清仓快照）。
// 闭轮为手动按钮，持有份额未归 0 时禁用（防止带持仓写快照）；进行中轮可删除误录交易。
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  addRoundTxn,
  closeRound,
  createRound,
  deleteRoundTxn,
  fetchFundNavs,
  fetchRounds,
  fetchWatchlist,
  type RoundData,
  type RoundMetrics,
  type WatchRow,
} from '@/lib/api';
import { fmt, fmt4, pnlValue, round2 } from '@/lib/format';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Stat({ label, value, pnl }: { label: string; value: string; pnl?: number | null }) {
  const cls = pnl != null ? pnlValue(pnl).cls : '';
  return (
    <div>
      <p className="text-xs text-dim">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

const money = (v: number | null) => (v == null ? '—' : fmt(v));

function MetricsGrid({ m }: { m: RoundMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="买入次数" value={String(m.buyCount)} />
      <Stat label="卖出次数" value={String(m.sellCount)} />
      <Stat label="总投入" value={fmt(m.invested)} />
      <Stat label="累计回款" value={fmt(m.proceeds)} />
      <Stat label="已实现盈亏" value={pnlValue(m.realizedPnl).text} pnl={m.realizedPnl} />
      <Stat label="已卖本金" value={fmt(m.soldPrincipal)} />
      <Stat label="持有本金" value={fmt(m.holdingPrincipal)} />
      <Stat label="持有份额" value={fmt(m.holdingShares)} />
      <Stat label="持仓市值" value={money(m.marketValue)} />
      <Stat label="浮动盈亏" value={m.floatingPnl != null ? pnlValue(m.floatingPnl).text : '—'} pnl={m.floatingPnl} />
      <Stat label="持仓收益·摊薄（对账）" value={m.dilutedHoldingPnl != null ? pnlValue(m.dilutedHoldingPnl).text : '—'} pnl={m.dilutedHoldingPnl} />
      <Stat label="轮总盈亏" value={m.totalPnl != null ? pnlValue(m.totalPnl).text : '—'} pnl={m.totalPnl} />
    </div>
  );
}

interface TxnFormProps {
  /** 该基金的 净值日期→单位净值 映射（用于按时间自动匹配确认净值） */
  navMap: Map<string, number>;
  onSubmit: (txn: { direction: 'buy' | 'sell'; date: string; amount: number; nav: number; shares: number; fee: number }) => Promise<string | null>;
}

function TxnForm({ navMap, onSubmit }: TxnFormProps) {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [nav, setNav] = useState('');
  const [shares, setShares] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastSuggestedShares = useRef('');
  // 净值/回款被手改过则不再用建议值覆盖
  const navTouched = useRef(false);
  const amountTouched = useRef(false);

  // 份额建议（买入）：本金 ÷ 净值（两位）；用户没手改过时自动跟随
  const suggestShares = (a: string, n: string): string => {
    const av = Number(a);
    const nv = Number(n);
    return Number.isFinite(av) && av > 0 && Number.isFinite(nv) && nv > 0 ? String(round2(av / nv)) : '';
  };
  // 回款建议（卖出）：份额 × 净值 − 手续费（两位）；用户没手改过时自动跟随
  const suggestProceeds = (s: string, n: string, f: string): string => {
    const sv = Number(s);
    const nv = Number(n);
    const fv = f === '' ? 0 : Number(f);
    if (!(Number.isFinite(sv) && sv > 0 && Number.isFinite(nv) && nv > 0)) return '';
    if (!Number.isFinite(fv) || fv < 0) return '';
    return String(Math.max(0, round2(sv * nv - fv)));
  };
  const onSharesNavFee = (s: string, n: string, f: string) => {
    if (direction === 'sell' && !amountTouched.current) setAmount(suggestProceeds(s, n, f));
  };
  const onAmountNav = (a: string, n: string) => {
    if (direction !== 'buy') return;
    const s = suggestShares(a, n);
    if (shares === '' || shares === lastSuggestedShares.current) setShares(s);
    lastSuggestedShares.current = s;
  };

  // 选择时间 → 自动匹配当日单位净值为确认净值；用户手改过则不覆盖
  const onDateChange = (d: string) => {
    setDate(d);
    const hit = navMap.get(d);
    if (hit != null && !navTouched.current) applyNav(String(hit));
  };
  const applyNav = (n: string) => {
    setNav(n);
    if (direction === 'buy') onAmountNav(amount, n);
    else onSharesNavFee(shares, n, fee);
  };
  const onNavChange = (n: string) => {
    navTouched.current = true;
    applyNav(n);
  };

  // 净值历史晚于日期选择加载完成时，补偿一次自动匹配
  useEffect(() => {
    const hit = navMap.get(date);
    if (hit != null && !navTouched.current) applyNav(String(hit));
  }, [navMap]);

  const navMiss = /^\d{4}-\d{2}-\d{2}$/.test(date) && !navMap.has(date);

  const submit = async () => {
    const txn = { direction, date, amount: Number(amount), nav: Number(nav), shares: Number(shares), fee: direction === 'sell' ? Number(fee) || 0 : 0 };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('日期需为 YYYY-MM-DD');
    if (!(txn.amount > 0) || !(txn.nav > 0) || !(txn.shares > 0)) return setError('金额 / 净值 / 份额需为正数');
    if (txn.fee < 0) return setError('手续费不能为负');
    setSubmitting(true);
    setError('');
    try {
      const errMsg = await onSubmit(txn);
      if (errMsg) {
        setError(errMsg);
      } else {
        setAmount('');
        setShares('');
        setFee('');
        lastSuggestedShares.current = '';
        amountTouched.current = false;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <label className="flex flex-col gap-1 text-xs text-dim">
        方向
        <select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value as 'buy' | 'sell');
            setAmount('');
            setShares('');
            setFee('');
            lastSuggestedShares.current = '';
            amountTouched.current = false;
          }}
        >
          <option value="buy">买入</option>
          <option value="sell">卖出</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-dim">
        {direction === 'buy' ? '买入时间' : '卖出时间'}
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-dim">
        确认净值
        <input type="number" min="0" step="0.0001" className="w-28" value={nav} onChange={(e) => onNavChange(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-dim">
        确认份额
        <input type="number" min="0" step="0.01" className="w-28" value={shares} onChange={(e) => { setShares(e.target.value); onSharesNavFee(e.target.value, nav, fee); }} />
      </label>
      {direction === 'sell' && (
        <label className="flex flex-col gap-1 text-xs text-dim">
          手续费
          <input type="number" min="0" step="0.01" className="w-24" value={fee} placeholder="0" onChange={(e) => { setFee(e.target.value); onSharesNavFee(shares, nav, e.target.value); }} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-dim">
        {direction === 'buy' ? '本金' : '回款（实际到账）'}
        <input
          type="number"
          min="0"
          step="0.01"
          className="w-28"
          value={amount}
          onChange={(e) => {
            if (direction === 'sell') {
              amountTouched.current = true;
              setAmount(e.target.value);
            } else {
              setAmount(e.target.value);
              onAmountNav(e.target.value, nav);
            }
          }}
        />
      </label>
      <button type="button" className="act act-primary" disabled={submitting} onClick={() => void submit()}>
        录入
      </button>
      {navMiss && <span className="text-xs text-warn">该日期无净值记录（非交易日或未入库），请手动输入确认净值</span>}
      {error && <span className="text-xs text-err">{error}</span>}
    </div>
  );
}

export function Rounds() {
  const [funds, setFunds] = useState<WatchRow[]>([]);
  const [fundCode, setFundCode] = useState('');
  const [rounds, setRounds] = useState<RoundData[] | null>(null);
  const [navMap, setNavMap] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    void fetchWatchlist().then((d) => {
      const rows = d?.ok && d.rows ? d.rows : [];
      setFunds(rows);
      if (rows.length > 0) setFundCode((prev) => prev || (rows[0]?.code ?? ''));
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!fundCode) {
      setRounds([]);
      return;
    }
    const d = await fetchRounds(fundCode);
    if (d?.ok && d.rounds) {
      setRounds(d.rounds);
      setError('');
    } else {
      setError(d?.error ?? '轮次加载失败，请确认服务在线');
    }
  }, [fundCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 基金切换时加载净值历史，供录入表单按日期匹配确认净值
  useEffect(() => {
    if (!fundCode) {
      setNavMap(new Map());
      return;
    }
    void fetchFundNavs(fundCode).then((d) => {
      setNavMap(d?.ok && d.rows ? new Map(d.rows.map((r) => [r.date, r.unitNav])) : new Map());
    });
  }, [fundCode]);

  const upsertRound = (round: RoundData) =>
    setRounds((prev) => (prev ?? []).some((r) => r.id === round.id) ? (prev ?? []).map((r) => (r.id === round.id ? round : r)) : [...(prev ?? []), round]);

  const startRound = async () => {
    const d = await createRound(fundCode);
    if (d?.ok && d.round) upsertRound(d.round);
    else setError(d?.error ?? '开轮失败');
  };

  const submitTxn = async (roundId: number, txn: Parameters<typeof addRoundTxn>[1]): Promise<string | null> => {
    const d = await addRoundTxn(roundId, txn);
    if (d?.ok && d.round) {
      upsertRound(d.round);
      return null;
    }
    return d?.error ?? '录入失败';
  };

  const removeTxn = async (roundId: number, txnId: number) => {
    const d = await deleteRoundTxn(roundId, txnId);
    if (d?.ok && d.round) upsertRound(d.round);
  };

  const close = async (roundId: number) => {
    const d = await closeRound(roundId);
    if (d?.ok && d.round) upsertRound(d.round);
    else setError(d?.error ?? '闭轮失败');
  };

  const active = rounds?.find((r) => r.status === 'active') ?? null;
  const closed = (rounds ?? []).filter((r) => r.status === 'closed');

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <label htmlFor="rounds-fund" className="text-[13px] text-dim">
          基金
        </label>
        <select id="rounds-fund" value={fundCode} onChange={(e) => setFundCode(e.target.value)}>
          {funds.length === 0 && <option value="">（先去关注基金）</option>}
          {funds.map((f) => (
            <option key={f.code} value={f.code}>
              {f.name} {f.code}
            </option>
          ))}
        </select>
        <button type="button" className="act act-primary" disabled={!fundCode || active != null} title={active ? '已有进行中的轮' : undefined} onClick={() => void startRound()}>
          开始新一轮
        </button>
        {error && <span className="text-xs text-err">{error}</span>}
      </div>

      {active && (
        <div className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-medium">第 {active.seq} 轮</p>
            <span className="badge badge-ok">进行中</span>
            <span className="text-xs text-dim">
              最新净值 {active.metrics.latestNav != null ? fmt4(active.metrics.latestNav) : '—（该基金暂无净值记录）'}
            </span>
            <button
              type="button"
              className="act ml-auto"
              disabled={active.metrics.holdingShares > 0.005}
              title={active.metrics.holdingShares > 0.005 ? `仍有持有份额 ${fmt(active.metrics.holdingShares)}，清仓后才能闭轮` : '写入清仓快照'}
              onClick={() => void close(active.id)}
            >
              清仓闭轮
            </button>
          </div>
          <MetricsGrid m={active.metrics} />
          <TxnForm key={active.id} navMap={navMap} onSubmit={(txn) => submitTxn(active.id, txn)} />
          {active.txns.length > 0 && (
            <table className="tabular-nums">
              <thead>
                <tr>
                  <th>方向</th>
                  <th>时间</th>
                  <th>{active.txns.some((t) => t.direction === 'sell') ? '金额（本金/回款）' : '金额'}</th>
                  <th>确认净值</th>
                  <th>确认份额</th>
                  <th>手续费</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {active.txns.map((t) => (
                  <tr key={t.id}>
                    <td className={t.direction === 'buy' ? 'text-up' : 'text-down'}>{t.direction === 'buy' ? '买入' : '卖出'}</td>
                    <td>{t.date}</td>
                    <td>{fmt(t.amount)}</td>
                    <td>{fmt4(t.nav)}</td>
                    <td>{fmt(t.shares)}</td>
                    <td>{t.direction === 'sell' && t.fee > 0 ? fmt(t.fee) : '—'}</td>
                    <td>
                      <button type="button" className="act" onClick={() => void removeTxn(active.id, t.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {rounds != null && rounds.length === 0 && fundCode && (
        <p className="text-sm text-dim">该基金还没有轮次——点击「开始新一轮」。</p>
      )}

      {closed.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                <th>轮次</th>
                <th>状态</th>
                <th>买入次数</th>
                <th>卖出次数</th>
                <th>总投入</th>
                <th>累计回款</th>
                <th>已实现盈亏</th>
                <th>已卖本金</th>
                <th>轮总盈亏</th>
                <th>闭轮时间</th>
                <th>明细</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((r) => (
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
                    <td className="text-dim">{r.closedAt ? new Date(r.closedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                    <td>
                      <button type="button" className="act" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? '收起' : '展开'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={11}>
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
