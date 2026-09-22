// 当前轮次页：进行中轮卡片（15 项指标分「盈亏总览 / 当前持仓 / 资金流水」三张归类卡片动态计算）+ 买卖录入 + 本轮交易表（可过滤方向/未匹配买入，可删误录）。
// 闭轮为手动按钮，持有份额未归 0 时禁用；已清仓轮次在「已清仓轮次」页查看。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addRoundTxn,
  closeRound,
  createRound,
  deleteRoundTxn,
  fetchFundNavs,
  fetchRounds,
  type BuyLotPnl,
  type OpenBuyLot,
  type RoundData,
  type RoundMetrics,
} from '@/lib/api';
import { MetricTip } from '@/components/MetricTip';
import { fmt, fmt4, pctValue, pnlValue, round2 } from '@/lib/format';
import { METRIC_FORMULAS } from '@/lib/formulas';
import { useFundSelection } from './useFundSelection';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function Stat({ label, tip, value, pnl }: { label: string; tip?: string; value: string; pnl?: number | null }) {
  const cls = pnl != null ? pnlValue(pnl).cls : '';
  return (
    <div>
      <p className="text-xs text-dim">
        <MetricTip label={label} tip={tip} />
      </p>
      <p className={`mt-0.5 font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

const money = (v: number | null) => (v == null ? '—' : fmt(v));

/** 买入行盈亏单元格：未卖出=浮动（最新净值），已清仓=已实现（卖出净值），部分卖出=合计并标注构成。 */
function BuyPnlCell({ p }: { p: BuyLotPnl | undefined }) {
  if (!p) return <span className="text-dim">—</span>;
  const hasRealized = Math.abs(p.realizedPnl) > 0.004;
  const holding = p.holdingShares > 0.004;
  // 部分卖出且有净值：合计（已实现 + 浮动），小字标注构成
  if (hasRealized && holding && p.floatingPnl != null) {
    const total = round2(p.realizedPnl + p.floatingPnl);
    return (
      <>
        <span className={pnlValue(total).cls}>{pnlValue(total).text}</span>
        <span className="text-xs text-dim">
          （已卖 {pnlValue(p.realizedPnl).text} · 持有 {pnlValue(p.floatingPnl).text}）
        </span>
      </>
    );
  }
  // 已清仓：已实现；持有中：浮动（无最新净值为 —）
  const v = holding ? p.floatingPnl : p.realizedPnl;
  if (v == null) return <span className="text-dim">—</span>;
  return <span className={pnlValue(v).cls}>{pnlValue(v).text}</span>;
}

// 交易表过滤：openBuy = 仍有剩余份额的买入批次（含部分卖出后的剩余）
type TxnFilter = 'all' | 'buy' | 'sell' | 'openBuy';
const TXN_FILTERS: { key: TxnFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'buy', label: '只看买入' },
  { key: 'sell', label: '只看卖出' },
  { key: 'openBuy', label: '未匹配买入' },
];

// 指标归类卡片：raised 底 + 细边框嵌套在外层轮卡片内，卡内指标两列网格
function MetricGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-raised/40 p-3">
      <p className="text-xs font-medium text-dim">{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </section>
  );
}

function MetricsGrid({ m }: { m: RoundMetrics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MetricGroup title="盈亏总览">
        {/* 轮总盈亏为本轮核心结论，大字号独占一行突出 */}
        <div className="col-span-2">
          <p className="text-xs text-dim">
            <MetricTip label="轮总盈亏" tip={METRIC_FORMULAS.totalPnl} />
          </p>
          <p className={`mt-0.5 text-xl font-bold tabular-nums ${m.totalPnl != null ? pnlValue(m.totalPnl).cls : ''}`}>
            {m.totalPnl != null ? pnlValue(m.totalPnl).text : '—'}
          </p>
        </div>
        <Stat label="轮总盈亏率" tip={METRIC_FORMULAS.totalPnl} value={m.totalPnlPct != null ? pctValue(m.totalPnlPct).text : '—'} pnl={m.totalPnlPct} />
        <Stat label="已实现盈亏" tip={METRIC_FORMULAS.realizedPnl} value={pnlValue(m.realizedPnl).text} pnl={m.realizedPnl} />
        <Stat label="浮动盈亏" tip={METRIC_FORMULAS.floatingPnl} value={m.floatingPnl != null ? pnlValue(m.floatingPnl).text : '—'} pnl={m.floatingPnl} />
        <Stat label="浮动盈亏率" tip={METRIC_FORMULAS.floatingPnl} value={m.floatingPnlPct != null ? pctValue(m.floatingPnlPct).text : '—'} pnl={m.floatingPnlPct} />
        <div className="col-span-2">
          <Stat label="持仓收益·摊薄（对账）" tip={METRIC_FORMULAS.dilutedHoldingPnl} value={m.dilutedHoldingPnl != null ? pnlValue(m.dilutedHoldingPnl).text : '—'} pnl={m.dilutedHoldingPnl} />
        </div>
      </MetricGroup>
      <MetricGroup title="当前持仓">
        <Stat label="持仓市值" tip={METRIC_FORMULAS.marketValue} value={money(m.marketValue)} />
        <Stat label="持有本金" tip={METRIC_FORMULAS.holdingPrincipal} value={fmt(m.holdingPrincipal)} />
        <Stat label="持有份额" tip={METRIC_FORMULAS.holdingShares} value={fmt(m.holdingShares)} />
        <Stat label="满30天份额" tip={METRIC_FORMULAS.sharesHeld30d} value={fmt(m.sharesHeld30d)} />
        <Stat label="最新净值" value={m.latestNav != null ? fmt4(m.latestNav) : '—'} />
      </MetricGroup>
      <MetricGroup title="资金流水">
        <Stat label="总投入" tip={METRIC_FORMULAS.invested} value={fmt(m.invested)} />
        <Stat label="累计回款" tip={METRIC_FORMULAS.proceeds} value={fmt(m.proceeds)} />
        <Stat label="已卖本金" tip={METRIC_FORMULAS.soldPrincipal} value={fmt(m.soldPrincipal)} />
        <Stat label="买入次数" tip={METRIC_FORMULAS.buyCount} value={String(m.buyCount)} />
        <Stat label="卖出次数" tip={METRIC_FORMULAS.sellCount} value={String(m.sellCount)} />
      </MetricGroup>
    </div>
  );
}

interface TxnFormProps {
  /** 该基金的 净值日期→单位净值 映射（用于按时间自动匹配确认净值） */
  navMap: Map<string, number>;
  /** 持有中的买入批次（卖出时供显式配对选择） */
  openBuys: OpenBuyLot[];
  /** 行内「卖出」按钮发起的配对请求（seq 递增触发，同一批次可重复发起） */
  pairRequest: { buyId: number; seq: number } | null;
  onSubmit: (txn: { direction: 'buy' | 'sell'; date: string; amount: number; nav: number; shares: number; fee: number; pairBuyId: number | null }) => Promise<string | null>;
}

function TxnForm({ navMap, openBuys, pairRequest, onSubmit }: TxnFormProps) {
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [nav, setNav] = useState('');
  const [shares, setShares] = useState('');
  const [fee, setFee] = useState('');
  const [pairBuyId, setPairBuyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const lastSuggestedShares = useRef('');
  // 净值/回款被手改过则不再用建议值覆盖
  const navTouched = useRef(false);
  const amountTouched = useRef(false);

  const pairedLot = pairBuyId != null ? openBuys.find((b) => b.id === pairBuyId) : undefined;

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

  // 行内「卖出」按钮发起配对：切卖出方向、锁定份额为该批次剩余份额，回款按建议值跟随
  useEffect(() => {
    if (!pairRequest) return;
    const lot = openBuys.find((b) => b.id === pairRequest.buyId);
    // 批次不在当前轮持有中（如切换基金/轮次后的残留请求）时忽略
    if (!lot) return;
    setDirection('sell');
    setPairBuyId(pairRequest.buyId);
    setAmount('');
    setFee('');
    amountTouched.current = false;
    const s = String(lot.shares);
    setShares(s);
    setAmount(suggestProceeds(s, nav, fee));
    // 仅在新的配对请求时触发（seq 变化），其余表单状态不联动
  }, [pairRequest?.seq]);

  // 取消配对：回到自动 FIFO，份额恢复可手输
  const clearPair = () => setPairBuyId(null);

  const submit = async () => {
    const txn = { direction, date, amount: Number(amount), nav: Number(nav), shares: Number(shares), fee: direction === 'sell' ? Number(fee) || 0 : 0, pairBuyId: direction === 'sell' ? pairBuyId : null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('日期需为 YYYY-MM-DD');
    if (!(txn.amount > 0) || !(txn.nav > 0) || !(txn.shares > 0)) return setError('金额 / 净值 / 份额需为正数');
    if (txn.fee < 0) return setError('手续费不能为负');
    if (direction === 'sell' && pairBuyId != null && pairedLot == null) return setError('配对买入已不存在，请重新选择');
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
        setPairBuyId(null);
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
            setPairBuyId(null);
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
      {direction === 'sell' && pairBuyId != null && (
        <span className="flex items-center gap-1 self-end pb-1 text-xs text-dim">
          配对 {pairedLot ? `${pairedLot.date} 买入 · ${fmt(pairedLot.shares)} 份 · 本金 ${fmt(pairedLot.principal)}` : `买入 #${pairBuyId}`}
          <button type="button" className="act" title="取消配对，回到自动 FIFO" onClick={clearPair}>
            ✕
          </button>
        </span>
      )}
      <label className="flex flex-col gap-1 text-xs text-dim">
        确认份额
        <input
          type="number"
          min="0"
          step="0.01"
          className="w-28"
          value={shares}
          disabled={direction === 'sell' && pairBuyId != null}
          title={direction === 'sell' && pairBuyId != null ? '整笔配对：份额锁定为配对买入的剩余份额' : undefined}
          onChange={(e) => { setShares(e.target.value); onSharesNavFee(e.target.value, nav, fee); }}
        />
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
  const { funds, fundCode, setFundCode } = useFundSelection();
  const [rounds, setRounds] = useState<RoundData[] | null>(null);
  const [navMap, setNavMap] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState('');
  // 行内「卖出」按钮 → 表单的配对请求（seq 递增保证同一批次可重复触发）
  const [pairRequest, setPairRequest] = useState<{ buyId: number; seq: number } | null>(null);
  const [txnFilter, setTxnFilter] = useState<TxnFilter>('all');

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
    if (d?.ok && d.round) {
      upsertRound(d.round);
      setError('');
    } else {
      setError(d?.error ?? '删除失败');
    }
  };

  const close = async (roundId: number) => {
    const d = await closeRound(roundId);
    if (d?.ok && d.round) upsertRound(d.round);
    else setError(d?.error ?? '闭轮失败');
  };

  const active = rounds?.find((r) => r.status === 'active') ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
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
        <div className="card flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-medium">第 {active.seq} 轮</p>
            <span className="badge badge-ok">进行中</span>
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
          <TxnForm key={active.id} navMap={navMap} openBuys={active.openBuys ?? []} pairRequest={pairRequest} onSubmit={(txn) => submitTxn(active.id, txn)} />
          {active.txns.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-dim">交易记录</span>
              {TXN_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={txnFilter === f.key ? 'act act-primary' : 'act'}
                  aria-pressed={txnFilter === f.key}
                  onClick={() => setTxnFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {active.txns.length > 0 && (
            // 交易表填满剩余视口高度，超出部分表内滚动
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="tabular-nums">
              <thead>
                <tr>
                  <th>方向</th>
                  <th>时间</th>
                  <th>{active.txns.some((t) => t.direction === 'sell') ? '金额（本金/回款）' : '金额'}</th>
                  <th>确认净值</th>
                  <th>确认份额</th>
                  <th>手续费</th>
                  <th><MetricTip label="盈亏" tip={METRIC_FORMULAS.buyLotPnl} /></th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // 买入批次剩余（openBuys）与显式配对标记（被 pairBuyId 指向的买入）
                  const openMap = new Map((active.openBuys ?? []).map((b) => [b.id, b]));
                  const pnlMap = new Map((active.buyPnls ?? []).map((b) => [b.id, b]));
                  const pairedBuyIds = new Set(active.txns.filter((t) => t.pairBuyId != null).map((t) => t.pairBuyId));
                  const visible = active.txns.filter((t) =>
                    txnFilter === 'all'
                      ? true
                      : txnFilter === 'buy'
                        ? t.direction === 'buy'
                        : txnFilter === 'sell'
                          ? t.direction === 'sell'
                          : t.direction === 'buy' && openMap.has(t.id),
                  );
                  if (visible.length === 0) {
                    return (
                      <tr>
                        <td colSpan={8} className="text-dim">
                          当前过滤条件下暂无交易记录
                        </td>
                      </tr>
                    );
                  }
                  return visible.map((t) => {
                    const lot = t.direction === 'buy' ? openMap.get(t.id) : undefined;
                    return (
                  <tr key={t.id}>
                    <td className={t.direction === 'buy' ? 'text-up' : 'text-down'}>
                      {t.direction === 'buy' ? '买入' : '卖出'}
                      {t.direction === 'sell' && t.pairBuyId != null && (
                        <span className="text-xs text-dim">（配对 {active.txns.find((b) => b.id === t.pairBuyId)?.date ?? `#${t.pairBuyId}`}）</span>
                      )}
                    </td>
                    <td>{t.date}</td>
                    <td>{fmt(t.amount)}</td>
                    <td>{fmt4(t.nav)}</td>
                    <td>
                      {fmt(t.shares)}
                      {t.direction === 'buy' && (
                        <span className="text-xs text-dim">
                          {lot ? (lot.shares < t.shares - 0.005 ? `（剩 ${fmt(lot.shares)}）` : '') : pairedBuyIds.has(t.id) ? '（已配对卖出）' : '（已清仓）'}
                        </span>
                      )}
                    </td>
                    <td>{t.direction === 'sell' && t.fee > 0 ? fmt(t.fee) : '—'}</td>
                    <td>{t.direction === 'buy' ? <BuyPnlCell p={pnlMap.get(t.id)} /> : <span className="text-dim">—</span>}</td>
                    <td className="whitespace-nowrap">
                      {t.direction === 'buy' && lot && (
                        <button type="button" className="act act-primary" onClick={() => setPairRequest({ buyId: t.id, seq: Date.now() })}>
                          卖出
                        </button>
                      )}{' '}
                      <button type="button" className="act" onClick={() => void removeTxn(active.id, t.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                    );
                  });
                })()}
              </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {rounds != null && active == null && fundCode && (
        <p className="text-sm text-dim">该基金没有进行中的轮次——点击「开始新一轮」；已清仓轮次见「已清仓轮次」页。</p>
      )}
    </div>
  );
}
