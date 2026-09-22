// 轮次接口：开轮 / 列表（进行中动态计算，已清仓读快照）/ 录入与删除交易 / 闭轮写快照。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db。
import { asRecord, HttpError, json, readJson, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from '../nav/store.ts';
import { openRoundsStore, type RoundsStore, type RoundRow } from './store.ts';
import { buyLotPnl, calcRound, openBuyLots, type BuyLotPnl, type RoundMetrics } from './calc.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 持有份额浮点噪声容差（份额两位小数累加） */
const SHARE_EPS = 0.005;

interface Stores {
  watch?: WatchStore;
  nav?: NavStore;
  rounds?: RoundsStore;
}

/** 持有中的买入批次（供卖出录入的显式配对选择）。 */
interface OpenBuy {
  id: number;
  date: string;
  nav: number;
  /** 剩余份额 */
  shares: number;
  /** 剩余本金 */
  principal: number;
}

function toResponse(round: RoundRow, txns: ReturnType<RoundsStore['listTxns']>, metrics: RoundMetrics, openBuys: OpenBuy[], buyPnls: BuyLotPnl[]) {
  return {
    id: round.id,
    fundCode: round.fundCode,
    seq: round.seq,
    status: round.status,
    createdAt: round.createdAt,
    closedAt: round.closedAt,
    metrics,
    openBuys,
    buyPnls,
    txns: txns.map((t) => ({ id: t.id, direction: t.direction, date: t.date, amount: t.amount, nav: t.nav, shares: t.shares, fee: t.fee, pairBuyId: t.pairBuyId })),
  };
}

export function roundsRoutes(stores?: Stores): Route[] {
  let lazyWatch = stores?.watch;
  let lazyNav = stores?.nav;
  let lazyRounds = stores?.rounds;
  const watch = (): WatchStore => (lazyWatch ??= openWatchStore());
  const nav = (): NavStore => (lazyNav ??= openNavStore());
  const rounds = (): RoundsStore => (lazyRounds ??= openRoundsStore());

  /** 已清仓轮指标直接读快照；进行中轮动态计算（最新净值取 fund_nav 最新一条）。 */
  const metricsOf = (round: RoundRow): { metrics: RoundMetrics; txns: ReturnType<RoundsStore['listTxns']>; openBuys: OpenBuy[]; buyPnls: BuyLotPnl[] } => {
    const txns = rounds().listTxns(round.id);
    if (round.status === 'closed') {
      return {
        txns,
        openBuys: [],
        buyPnls: buyLotPnl(txns, null),
        metrics: {
          buyCount: round.buyCount ?? 0,
          sellCount: round.sellCount ?? 0,
          invested: round.invested ?? 0,
          proceeds: round.proceeds ?? 0,
          realizedPnl: round.realizedPnl ?? 0,
          soldPrincipal: round.soldPrincipal ?? 0,
          holdingPrincipal: 0,
          holdingShares: 0,
          dilutedCost: 0,
          dilutedRealizedPnl: round.realizedPnl ?? 0,
          latestNav: null,
          marketValue: null,
          floatingPnl: null,
          dilutedHoldingPnl: null,
          totalPnl: round.totalPnl ?? 0,
          floatingPnlPct: null,
          totalPnlPct:
            (round.invested ?? 0) > 0 ? Math.round(((round.totalPnl ?? 0) / (round.invested ?? 1)) * 10000) / 100 : null,
        },
      };
    }
    const fund = watch().findByCode(round.fundCode);
    const latest = fund ? nav().latestByFund(fund.id) : null;
    const byId = new Map(txns.map((t) => [t.id, t]));
    const openBuys = openBuyLots(txns).flatMap((l) => {
      const t = l.id != null ? byId.get(l.id) : undefined;
      return l.id != null && t ? [{ id: l.id, date: t.date, nav: t.nav, shares: l.shares, principal: l.principal }] : [];
    });
    return { txns, metrics: calcRound(txns, latest?.unitNav ?? null), openBuys, buyPnls: buyLotPnl(txns, latest?.unitNav ?? null) };
  };

  const mustActiveRound = (id: number): RoundRow => {
    const round = rounds().getRound(id);
    if (!round) throw new HttpError(404, '轮次不存在');
    if (round.status !== 'active') throw new HttpError(400, '该轮已清仓，只读');
    return round;
  };

  return [
    {
      method: 'GET',
      path: '/api/rounds',
      handler: ({ res, url }) => {
        const fundCode = url.searchParams.get('fund') ?? '';
        if (!fundCode) throw new HttpError(400, '缺少 fund 参数');
        json(res, 200, {
          ok: true,
          rounds: rounds()
            .listRounds(fundCode)
            .map((r) => {
              const { metrics, txns, openBuys, buyPnls } = metricsOf(r);
              return toResponse(r, txns, metrics, openBuys, buyPnls);
            }),
        });
      },
    },
    {
      method: 'POST',
      path: '/api/rounds',
      handler: async ({ req, res }) => {
        const body = asRecord(await readJson(req));
        const fundCode = typeof body?.fundCode === 'string' ? body.fundCode.trim() : '';
        const fund = fundCode ? watch().findByCode(fundCode) : null;
        if (!fund || fund.active !== 1) throw new HttpError(400, '该基金不在关注列表');
        if (rounds().activeRound(fundCode)) throw new HttpError(400, '该基金已有进行中的轮');
        const round = rounds().createRound(fundCode);
        const { metrics, txns, openBuys, buyPnls } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics, openBuys, buyPnls) });
      },
    },
    {
      method: 'POST',
      path: '/api/rounds/:id/txns',
      handler: async ({ req, res, params }) => {
        const round = mustActiveRound(Number(params.id));
        const body = asRecord(await readJson(req));
        const direction = body?.direction === 'sell' ? 'sell' : body?.direction === 'buy' ? 'buy' : null;
        const date = typeof body?.date === 'string' ? body.date.trim() : '';
        const amount = Number(body?.amount);
        const navValue = Number(body?.nav);
        const shares = Number(body?.shares);
        const fee = body?.fee == null ? 0 : Number(body.fee);
        if (!direction) throw new HttpError(400, 'direction 需为 buy 或 sell');
        if (!DATE_RE.test(date)) throw new HttpError(400, 'date 需为 YYYY-MM-DD 格式');
        if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount 需为正数');
        if (!Number.isFinite(navValue) || navValue <= 0) throw new HttpError(400, 'nav 需为正数');
        if (!Number.isFinite(shares) || shares <= 0) throw new HttpError(400, 'shares 需为正数');
        if (!Number.isFinite(fee) || fee < 0) throw new HttpError(400, 'fee 需为非负数');
        const pairBuyId = body?.pairBuyId == null ? null : Number(body.pairBuyId);
        if (pairBuyId != null && (!Number.isInteger(pairBuyId) || pairBuyId <= 0)) throw new HttpError(400, 'pairBuyId 需为正整数');
        if (direction !== 'sell' && pairBuyId != null) throw new HttpError(400, 'pairBuyId 仅卖出适用');
        if (direction === 'sell') {
          const existing = rounds().listTxns(round.id);
          if (pairBuyId != null) {
            const buy = existing.find((t) => t.id === pairBuyId);
            if (!buy || buy.direction !== 'buy') throw new HttpError(400, '配对买入不存在或不属于本轮');
            // 该买入已被显式配对消耗的份额 + 本次卖出不得超过其确认份额
            const pairedShares = existing.filter((t) => t.pairBuyId === pairBuyId).reduce((s, t) => s + t.shares, 0);
            if (pairedShares + shares > buy.shares + SHARE_EPS) {
              const r2 = (n: number) => Math.round(n * 100) / 100;
              throw new HttpError(400, `配对买入剩余份额不足（已配对 ${r2(pairedShares)} / ${buy.shares} 份）`);
            }
          }
          const { holdingShares } = calcRound(existing, null);
          if (shares > holdingShares + SHARE_EPS) throw new HttpError(400, `卖出份额超过当前持有（${holdingShares} 份）`);
        }
        rounds().addTxn(round.id, { direction, date, amount, nav: navValue, shares, fee, pairBuyId });
        const { metrics, txns, openBuys, buyPnls } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics, openBuys, buyPnls) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/rounds/:id/txns/:txnId',
      handler: ({ res, params }) => {
        const round = mustActiveRound(Number(params.id));
        const txnId = Number(params.txnId);
        // 被显式配对的买入不可直接删除（需先删除对应卖出），避免配对悬空
        const txnsBefore = rounds().listTxns(round.id);
        const target = txnsBefore.find((t) => t.id === txnId);
        if (target?.direction === 'buy' && txnsBefore.some((t) => t.pairBuyId === txnId)) {
          throw new HttpError(400, '该买入已被卖出显式配对，请先删除对应卖出记录');
        }
        const removed = rounds().deleteTxn(round.id, txnId);
        if (!removed) throw new HttpError(404, '交易记录不存在');
        const { metrics, txns, openBuys, buyPnls } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics, openBuys, buyPnls) });
      },
    },
    {
      method: 'POST',
      path: '/api/rounds/:id/close',
      handler: ({ res, params }) => {
        const round = mustActiveRound(Number(params.id));
        const m = calcRound(rounds().listTxns(round.id), null);
        if (Math.abs(m.holdingShares) > SHARE_EPS) {
          throw new HttpError(400, `仍有持有份额 ${m.holdingShares}，清仓后才能闭轮`);
        }
        rounds().closeRound(round.id, {
          buyCount: m.buyCount,
          sellCount: m.sellCount,
          invested: m.invested,
          proceeds: m.proceeds,
          realizedPnl: m.realizedPnl,
          soldPrincipal: m.soldPrincipal,
          totalPnl: m.realizedPnl, // 清仓后总盈亏 = 已实现盈亏
        });
        const closed = rounds().getRound(round.id) as RoundRow;
        const { metrics, txns, openBuys, buyPnls } = metricsOf(closed);
        json(res, 200, { ok: true, round: toResponse(closed, txns, metrics, openBuys, buyPnls) });
      },
    },
  ];
}
