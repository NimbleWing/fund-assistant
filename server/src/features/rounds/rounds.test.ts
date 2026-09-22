// rounds 单测：calcRound（FIFO 分批消耗 + 摊薄口径）、store 读写（含 fee 迁移）、路由全流程（开轮/录入/闭轮/校验）。
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError, json, type Route } from '../../lib/http.ts';
import { openWatchStore } from '../watchlist/store.ts';
import { openNavStore } from '../nav/store.ts';
import { openRoundsStore } from './store.ts';
import { calcRound, openBuyLots, type RoundTxnInput } from './calc.ts';
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
      floatingPnlPct: 66.67, totalPnlPct: 66.67,
    });
  });

  it('无净值数据时市值类指标为 null', () => {
    const m = calcRound([buy(1000, 2, 500)], null);
    expect(m.marketValue).toBeNull();
    expect(m.floatingPnl).toBeNull();
    expect(m.dilutedHoldingPnl).toBeNull();
    expect(m.totalPnl).toBeNull();
    expect(m.floatingPnlPct).toBeNull();
    expect(m.totalPnlPct).toBeNull();
  });

  it('FIFO 分批消耗：一次卖出跨两笔买入，按份额比例消耗本金', () => {
    // 买 1000@2=500份、2000@4=500份；卖 750 份回款 2250（@3）
    // FIFO：消耗第一批 500 份本金 1000 + 第二批 250 份本金 1000 → 已卖本金 2000，已实现 +250
    const m = calcRound([buy(1000, 2, 500), buy(2000, 4, 500), sell(2250, 3, 750)], 3);
    expect(m).toMatchObject({
      invested: 3000, proceeds: 2250, soldPrincipal: 2000, realizedPnl: 250,
      holdingShares: 250, holdingPrincipal: 1000,
      marketValue: 750, floatingPnl: -250, totalPnl: 0,
      floatingPnlPct: -25, totalPnlPct: 0,
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
    expect(m).toMatchObject({ holdingShares: 0, holdingPrincipal: 0, realizedPnl: 250, totalPnl: 250, marketValue: 0, totalPnlPct: 25 });
    expect(m.floatingPnlPct).toBeNull(); // 清仓后无持有本金，浮动盈亏率不可算
  });

  it('显式配对：卖出指定 pairBuyId 时整笔消耗该买入（而非 FIFO 的最早批次）', () => {
    // 买A 1000@2=500份、买B 2000@4=500份；卖 500 份显式配对 B，回款 2600（@5.2）
    // 纯 FIFO 会消耗 A → 已卖本金 1000；显式配对消耗 B → 已卖本金 2000，已实现 +600，持有为 A 的 1000
    const txns: RoundTxnInput[] = [
      { id: 1, direction: 'buy', amount: 1000, nav: 2, shares: 500 },
      { id: 2, direction: 'buy', amount: 2000, nav: 4, shares: 500 },
      { id: 3, direction: 'sell', amount: 2600, nav: 5.2, shares: 500, pairBuyId: 2 },
    ];
    const m = calcRound(txns, 5.2);
    expect(m).toMatchObject({
      invested: 3000, proceeds: 2600, soldPrincipal: 2000, realizedPnl: 600,
      holdingShares: 500, holdingPrincipal: 1000,
      marketValue: 2600, floatingPnl: 1600, totalPnl: 2200,
    });
    expect(openBuyLots(txns)).toEqual([{ id: 1, shares: 500, principal: 1000 }]);
  });

  it('显式配对不足部分退回 FIFO：卖出份额超过配对批次剩余时跨批次消耗', () => {
    // 买A 1000@2=500份、买B 2000@4=500份；卖 750 份显式配对 A → 消耗 A 全部 500 份（本金 1000）+ FIFO 从 B 取 250 份（本金 1000）
    const txns: RoundTxnInput[] = [
      { id: 1, direction: 'buy', amount: 1000, nav: 2, shares: 500 },
      { id: 2, direction: 'buy', amount: 2000, nav: 4, shares: 500 },
      { id: 3, direction: 'sell', amount: 2250, nav: 3, shares: 750, pairBuyId: 1 },
    ];
    const m = calcRound(txns, 3);
    expect(m).toMatchObject({ soldPrincipal: 2000, realizedPnl: 250, holdingShares: 250, holdingPrincipal: 1000 });
    expect(openBuyLots(txns)).toEqual([{ id: 2, shares: 250, principal: 1000 }]);
  });
});

describe('rounds store', () => {
  it('listTxns 按交易时间排序（同日按录入顺序），与录入先后无关', () => {
    const s = openRoundsStore(':memory:');
    try {
      const round = s.createRound('110022');
      s.addTxn(round.id, { direction: 'buy', date: '2026-09-10', amount: 100, nav: 1, shares: 100 });
      s.addTxn(round.id, { direction: 'buy', date: '2026-09-01', amount: 100, nav: 1, shares: 100 });
      s.addTxn(round.id, { direction: 'sell', date: '2026-09-10', amount: 110, nav: 1.1, shares: 100 });
      expect(s.listTxns(round.id).map((t) => `${t.date}:${t.direction}`)).toEqual([
        '2026-09-01:buy',
        '2026-09-10:buy',
        '2026-09-10:sell',
      ]);
    } finally {
      s.close();
    }
  });

  it('round_txn 迁移：旧表缺 fee / pair_buy_id 列时打开自动补列，存量行默认 0 / null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rounds-migrate-'));
    const file = path.join(dir, 't.db');
    try {
      const db = new DatabaseSync(file);
      db.exec(`CREATE TABLE round_txn(
        id INTEGER PRIMARY KEY AUTOINCREMENT, round_id INTEGER NOT NULL, direction TEXT NOT NULL,
        date TEXT NOT NULL, amount REAL NOT NULL, nav REAL NOT NULL, shares REAL NOT NULL, created_at TEXT NOT NULL)`);
      db.prepare("INSERT INTO round_txn(round_id, direction, date, amount, nav, shares, created_at) VALUES (1, 'sell', '2026-09-01', 1250, 2.5, 500, 't')").run();
      db.close();
      const s = openRoundsStore(file);
      expect(s.listTxns(1)[0]?.fee).toBe(0);
      expect(s.listTxns(1)[0]?.pairBuyId).toBeNull();
      s.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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

    // 录入两笔买入一笔卖出（跨批次，卖出含手续费 5）
    await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-01', amount: 1000, nav: 2, shares: 500 });
    await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-08', amount: 2000, nav: 4, shares: 500 });
    const afterSell = (await (
      await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-15', amount: 2250, nav: 3, shares: 750, fee: 5 })
    ).json()) as { round: { metrics: { realizedPnl: number; holdingShares: number; latestNav: number; totalPnl: number; floatingPnlPct: number | null; totalPnlPct: number | null }; txns: { fee: number }[] } };
    expect(afterSell.round.metrics).toMatchObject({ realizedPnl: 250, holdingShares: 250, latestNav: 3.722, totalPnl: 180.5, floatingPnlPct: -6.95, totalPnlPct: 6.02 });
    expect(afterSell.round.txns[2]?.fee).toBe(5); // 手续费已落库（回款为实际到账，盈亏不受影响）

    // 持有份额未归 0，闭轮 → 400
    expect((await post(`/api/rounds/${rid}/close`)).status).toBe(400);

    // 卖出剩余 250 份（消耗第二批剩余本金 1000，回款 1250 → 本笔 +250）
    await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-21', amount: 1250, nav: 5, shares: 250 });
    const closed = (await (await post(`/api/rounds/${rid}/close`)).json()) as {
      round: { status: string; metrics: { totalPnl: number; realizedPnl: number; floatingPnlPct: number | null; totalPnlPct: number | null }; closedAt: string };
    };
    expect(closed.round.status).toBe('closed');
    expect(closed.round.metrics).toMatchObject({ realizedPnl: 500, totalPnl: 500, floatingPnlPct: null, totalPnlPct: 16.67 });
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

  it('卖出显式配对：指标按配对批次计算；被配对买入不可删，先删卖出后可删', async () => {
    const rid = rounds.activeRound('018994')?.id;
    interface TxnView { id: number; pairBuyId: number | null }
    interface RoundView { metrics: { soldPrincipal: number; realizedPnl: number; holdingPrincipal: number }; txns: TxnView[]; openBuys: { id: number; shares: number }[] }
    const afterB1 = (await (await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-22', amount: 1000, nav: 2, shares: 500 })).json()) as { round: RoundView };
    const afterB2 = (await (await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-22', amount: 2000, nav: 4, shares: 500 })).json()) as { round: RoundView };
    const b1 = afterB1.round.txns[0]?.id as number;
    const b2 = afterB2.round.txns[1]?.id as number;
    expect(afterB2.round.openBuys.map((b) => b.id)).toEqual([b1, b2]);

    // 非法配对：买入带 pairBuyId / 批次不存在 / 超过配对批次份额 → 400
    expect((await post(`/api/rounds/${rid}/txns`, { direction: 'buy', date: '2026-09-22', amount: 1, nav: 1, shares: 1, pairBuyId: b1 })).status).toBe(400);
    expect((await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-22', amount: 1, nav: 1, shares: 1, pairBuyId: 999999 })).status).toBe(400);
    expect((await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-22', amount: 1, nav: 1, shares: 600, pairBuyId: b1 })).status).toBe(400);

    // 显式配对 b2 卖出 500 份（回款 2600@5.2）：已卖本金 = b2 本金 2000，已实现 600，持有为 b1 的 1000
    const afterSell = (await (
      await post(`/api/rounds/${rid}/txns`, { direction: 'sell', date: '2026-09-22', amount: 2600, nav: 5.2, shares: 500, pairBuyId: b2 })
    ).json()) as { round: RoundView };
    expect(afterSell.round.metrics).toMatchObject({ soldPrincipal: 2000, realizedPnl: 600, holdingPrincipal: 1000 });
    expect(afterSell.round.txns[2]?.pairBuyId).toBe(b2);
    expect(afterSell.round.openBuys.map((b) => b.id)).toEqual([b1]);

    // 被显式配对的买入不可删 → 400；先删卖出后可删
    expect((await fetch(`${base}/api/rounds/${rid}/txns/${b2}`, { method: 'DELETE' })).status).toBe(400);
    const sellId = afterSell.round.txns[2]?.id as number;
    await fetch(`${base}/api/rounds/${rid}/txns/${sellId}`, { method: 'DELETE' });
    expect((await fetch(`${base}/api/rounds/${rid}/txns/${b2}`, { method: 'DELETE' })).status).toBe(200);
    await fetch(`${base}/api/rounds/${rid}/txns/${b1}`, { method: 'DELETE' });
  });
});
