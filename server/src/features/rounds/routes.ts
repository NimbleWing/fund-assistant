// 轮次接口：开轮 / 列表（进行中动态计算，已清仓读快照）/ 录入与删除交易 / 闭轮写快照。
// store 可注入（测试用 :memory:）；默认惰性打开 server/fund.db。
import { asRecord, HttpError, json, readJson, type Route } from '../../lib/http.ts';
import { openWatchStore, type WatchStore } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from '../nav/store.ts';
import { openRoundsStore, type RoundsStore, type RoundRow } from './store.ts';
import { calcRound, type RoundMetrics } from './calc.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 持有份额浮点噪声容差（份额两位小数累加） */
const SHARE_EPS = 0.005;

interface Stores {
  watch?: WatchStore;
  nav?: NavStore;
  rounds?: RoundsStore;
}

function toResponse(round: RoundRow, txns: ReturnType<RoundsStore['listTxns']>, metrics: RoundMetrics) {
  return {
    id: round.id,
    fundCode: round.fundCode,
    seq: round.seq,
    status: round.status,
    createdAt: round.createdAt,
    closedAt: round.closedAt,
    metrics,
    txns: txns.map((t) => ({ id: t.id, direction: t.direction, date: t.date, amount: t.amount, nav: t.nav, shares: t.shares })),
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
  const metricsOf = (round: RoundRow): { metrics: RoundMetrics; txns: ReturnType<RoundsStore['listTxns']> } => {
    const txns = rounds().listTxns(round.id);
    if (round.status === 'closed') {
      return {
        txns,
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
        },
      };
    }
    const fund = watch().findByCode(round.fundCode);
    const latest = fund ? nav().latestByFund(fund.id) : null;
    return { txns, metrics: calcRound(txns, latest?.unitNav ?? null) };
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
              const { metrics, txns } = metricsOf(r);
              return toResponse(r, txns, metrics);
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
        const { metrics, txns } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics) });
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
        if (!direction) throw new HttpError(400, 'direction 需为 buy 或 sell');
        if (!DATE_RE.test(date)) throw new HttpError(400, 'date 需为 YYYY-MM-DD 格式');
        if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'amount 需为正数');
        if (!Number.isFinite(navValue) || navValue <= 0) throw new HttpError(400, 'nav 需为正数');
        if (!Number.isFinite(shares) || shares <= 0) throw new HttpError(400, 'shares 需为正数');
        if (direction === 'sell') {
          const { holdingShares } = calcRound(rounds().listTxns(round.id), null);
          if (shares > holdingShares + SHARE_EPS) throw new HttpError(400, `卖出份额超过当前持有（${holdingShares} 份）`);
        }
        rounds().addTxn(round.id, { direction, date, amount, nav: navValue, shares });
        const { metrics, txns } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/rounds/:id/txns/:txnId',
      handler: ({ res, params }) => {
        const round = mustActiveRound(Number(params.id));
        const removed = rounds().deleteTxn(round.id, Number(params.txnId));
        if (!removed) throw new HttpError(404, '交易记录不存在');
        const { metrics, txns } = metricsOf(round);
        json(res, 200, { ok: true, round: toResponse(round, txns, metrics) });
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
        const { metrics, txns } = metricsOf(closed);
        json(res, 200, { ok: true, round: toResponse(closed, txns, metrics) });
      },
    },
  ];
}
