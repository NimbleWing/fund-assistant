// rounds 单测：calcRound（FIFO 分批消耗 + 摊薄口径）、store 读写、路由全流程（开轮/录入/闭轮/校验）。
import type { Server } from 'node:http';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, json, type Route } from '../../lib/http.ts';
import { openWatchStore } from '../watchlist/store.ts';
import { openNavStore } from '../nav/store.ts';
import { openRoundsStore } from './store.ts';
import { calcRound, type RoundTxnInput } from './calc.ts';
import { roundsRoutes } from './routes.ts';

describe('calcRound', () => {
  const buy = (amount: number, nav: number, shares: number): RoundTxnInput => ({ direction: 'buy', amount, nav, shares });
  const sell = (amount: number, nav: number, shares: number): RoundTxnInput => ({ direction: 'sell', amount, nav, shares });

  it('纯买入：投入/份额/持有本金，市值类指标随净值联动', () => {
    const m = calcRound([buy(1000, 2, 500), buy(2000, 4, 500)], 5);
    expect(m).toMatchObject({
      buyCount: 2, sellCount: 0, invested: 3000, proceeds: 0,
      holdingShares: 1000, holdingPrincipal: 3000, realizedPnl: 0, soldPrincipal: 0,
      dilutedCost: 3000, marketValue: 5000, floatingPnl: 2000, dilutedHoldingPnl: 2000, totalPnl: 2000,
    });
  });

  it('无净值数据时市值类指标为 null', () => {
    const m = calcRound([buy(1000, 2, 500)], null);
    expect(m.marketValue).toBeNull();
    expect(m.floatingPnl).toBeNull();
    expect(m.dilutedHoldingPnl).toBeNull();
    expect(m.totalPnl).toBeNull();
  });

  it('FIFO 分批消耗：一次卖出跨两笔买入，按份额比例消耗本金', () => {
    // 买 1000@2=500份、2000@4=500份；卖 750 份回款 2250（@3）
    // FIFO：消耗第一批 500 份本金 1000 + 第二批 250 份本金 1000 → 已卖本金 2000，已实现 +250
    const m = calcRound([buy(1000, 2, 500), buy(2000, 4, 500), sell(2250, 3, 750)], 3);
    expect(m).toMatchObject({
      invested: 3000, proceeds: 2250, soldPrincipal: 2000, realizedPnl: 250,
      holdingShares: 250, holdingPrincipal: 1000,
      marketValue: 750, floatingPnl: -250, totalPnl: 0,
    });
    // 摊薄：均价 3，扣减 750×3=2250，摊薄已实现 0，摊薄成本 750，持仓收益·摊薄 0
    expect(m.dilutedCost).toBe(750);
    expect(m.dilutedRealizedPnl).toBe(0);
    expect(m.dilutedHoldingPnl).toBe(0);
    // 勾稽：浮动 + 已实现 = 总盈亏；摊薄持仓收益 + 摊薄已实现 = 总盈亏
    expect(m.floatingPnl! + m.realizedPnl).toBe(m.totalPnl);
    expect(m.dilutedHoldingPnl! + m.dilutedRealizedPnl).toBe(m.totalPnl);
  });

  it('清仓：持有归 0，总盈亏 = 已实现盈亏', () => {
    const m = calcRound([buy(1000, 2, 500), sell(1250, 2.5, 500)], 3);
    expect(m).toMatchObject({ holdingShares: 0, holdingPrincipal: 0, realizedPnl: 250, totalPnl: 250, marketValue: 0 });
  });
});

describe('rounds routes', () => {
  let server: Server;
  let base = '';
  const watch = openWatchStore(':memory:');
  const nav = openNavStore(':memory:');
  const rounds = openRoundsStore(':memory:');
  const fund = watch.add('018994', '中欧数字经济混合发起C', '混合型');
  nav.insertIgnore(fund.id, '2026-09-21', 3.722);

  beforeAll(async () => {
    const routes: Route[] = roundsRoutes({ watch, nav, rounds });
    server = http.createServer((req, res) => {
      void (async () => {
        try {
          const u = new URL(req.url ?? '/', 'http://127.0.0.1');
          for (const r of routes) {
            if (r.method !== req.method) continue;
            const ps = r.path.split('/');
            const xs = u.pathname.split('/');
            if (ps.length !== xs.length) continue;
            const params: Record<string, string> = {};
            let ok = true;
            for (let i = 0; i < ps.length; i++) {
              const p = ps[i] as string;
              if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(xs[i] as string);
              else if (p !== xs[i]) { ok = false; break; }
            }
            if (!ok) continue;
            await r.handler({ req, res, url: u, params });
            return;
          }
          json(res, 404, { ok: false, error: 'not found' });
        } catch (e: unknown) {
          if (e instanceof HttpError) json(res, e.code, { ok: false, error: e.message });
          else json(res, 500, { ok: false, error: String(e) });
        }
      })();
    }).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    if (addr == null || typeof addr === 'string') throw new Error('无法获取监听端口');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    watch.close();
    nav.close();
    rounds.close();
  });

  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });

  it('全流程：开轮 → 录入买卖 → 动态指标 → 闭轮快照 → 新一轮', async () => {
    // 开轮
    const created = (await (await post('/api/rounds', { fundCode: '018994' })).json()) as { round: { id: number; seq: number; status: string } };
    expect(created.round).toMatchObject({ seq: 1, status: 'active' });
    const rid = created.round.id;
    // 重复开轮 → 400
    expect((await post('/api/rounds', { fundCode: '018994' })).status).toBe(400);

    // 录入两笔买入一笔卖出（跨批次）
    await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500 });
    await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-08', amount: 2000, nav: 4, shares: 500 });
    const afterSell = (await (
      await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-15', amount: 2250, nav: 3, shares: 750 })
    ).json()) as { round: { metrics: { realizedPnl: number; holdingShares: number; latestNav: number; totalPnl: number } } };
    expect(afterSell.round.metrics).toMatchObject({ realizedPnl: 250, holdingShares: 250, latestNav: 3.722, totalPnl: 180.5 });

    // 持有份额未归 0，闭轮 → 400
    expect((await post(`/api/rounds/${rid}/close`)).status).toBe(400);

    // 卖出剩余 250 份（消耗第二批剩余本金 1000，回款 1250 → 本笔 +250）
    await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-21', amount: 1250, nav: 5, shares: 250 });
    const closed = (await (await post(`/api/rounds/${rid}/close`)).json()) as {
      round: { status: string; metrics: { totalPnl: number; realizedPnl: number }; closedAt: string };
    };
    expect(closed.round.status).toBe('closed');
    expect(closed.round.metrics).toMatchObject({ realizedPnl: 500, totalPnl: 500 });
    expect(closed.round.closedAt).toBeTruthy();

    // 已清仓轮只读：录入/删交易/重复闭轮 → 400
    expect((await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-22', amount: 1, nav: 1, shares: 1 })).status).toBe(400);
    expect((await post(`/api/rounds/${rid}/close`)).status).toBe(400);

    // 列表：已清仓读快照；新一轮 seq=2
    const list = (await (await fetch(`${base}/api/rounds?fund=018994`)).json()) as { rounds: { seq: number; status: string; metrics: { totalPnl: number }; txns: unknown[] }[] };
    expect(list.rounds).toHaveLength(1);
    expect(list.rounds[0]?.metrics.totalPnl).toBe(500);
    expect(list.rounds[0]?.txns).toHaveLength(4);
    const second = (await (await post('/api/rounds', { fundCode: '018994' })).json()) as { round: { seq: number } };
    expect(second.round.seq).toBe(2);
  });

  it('校验：卖出超额 / 未关注基金 / 非法字段', async () => {
    const active = rounds.activeRound('018994');
    expect((await post(`/api/rounds/${active?.id}/txns`, { direction: 'sell', date: '2026-09-22', amount: 1, nav: 1, shares: 10 })).status).toBe(400);
    expect((await post('/api/rounds', { fundCode: '999999' })).status).toBe(400);
    expect((await post(`/api/rounds/${active?.id}/txns`, { direction: 'buy', date: '9-22', amount: 1, nav: 1, shares: 1 })).status).toBe(400);
  });

  it('删除误录交易后指标联动', async () => {
    const active = rounds.activeRound('018994');
    const added = (await (
      await post(`/api/rounds/${active?.id}/txns`, { direction: 'buy', date: '2026-09-22', amount: 500, nav: 2.5, shares: 200 })
    ).json()) as { round: { txns: { id: number }[]; metrics: { invested: number; holdingShares: number } } };
    expect(added.round.metrics.invested).toBe(500);
    const txnId = added.round.txns[0]?.id;
    const after = (await (
      await fetch(`${base}/api/rounds/${active?.id}/txns/${txnId}`, { method: 'DELETE' })
    ).json()) as { round: { metrics: { invested: number; holdingShares: number }; txns: unknown[] } };
    expect(after.round.metrics.invested).toBe(0);
    expect(after.round.txns).toHaveLength(0);
  });
});
