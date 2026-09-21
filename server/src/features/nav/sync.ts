// 启动净值同步：按「期望净值日期」驱动（见 DESIGN.md §10）。
// 20:00 前期望上一交易日（缺失抓一次即止）；20:00 后期望当日净值（缺失立即抓一次，
// 仍未公布则每小时轮询，直到入库或跨日自动停止）。基金间间隔 500ms，单只失败仅记日志。
import { openWatchStore, type WatchStore, type WatchRow } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from './store.ts';
import { fetchNavHistory } from './fetch.ts';
import type { FetchLike } from '../funds/search.ts';

const FUND_INTERVAL_MS = 500;
const RETRY_INTERVAL_MS = 60 * 60 * 1000;
const PUBLISH_HOUR = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 期望净值日期：20:00 前为上一交易日，20:00 后为当日；周末回退到最近周五（节假日不识别）。 */
export function expectedLatestNavDate(now: Date): string {
  const d = new Date(now.getTime());
  if (d.getHours() < PUBLISH_HOUR) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return fmtDate(d);
}

export interface NavSyncController {
  /** 首轮同步完成的 Promise（测试/观测用） */
  done: Promise<void>;
  stop(): void;
}

export function startNavSync(opts?: {
  watchStore?: WatchStore;
  navStore?: NavStore;
  fetchImpl?: FetchLike;
  /** 当前时间源（测试注入固定时刻） */
  now?: () => Date;
  /** 20:00 后未公布时的轮询间隔（默认 1 小时，测试传小值） */
  retryIntervalMs?: number;
  log?: (msg: string) => void;
}): NavSyncController {
  const log = opts?.log ?? ((msg: string) => console.log(`[nav-sync] ${msg}`));
  const ownWatch = opts?.watchStore == null;
  const ownNav = opts?.navStore == null;
  const watch = opts?.watchStore ?? openWatchStore();
  const nav = opts?.navStore ?? openNavStore();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowFn = opts?.now ?? (() => new Date());

  const startupDay = fmtDate(nowFn());
  const canRetry = nowFn().getHours() >= PUBLISH_HOUR;
  const pending = new Set<number>(); // 等待当日净值公布的 watchlist_id
  let timer: ReturnType<typeof setInterval> | null = null;

  const syncFund = async (f: WatchRow, expected: string): Promise<void> => {
    if (nav.hasDate(f.id, expected)) {
      pending.delete(f.id);
      return;
    }
    const points = await fetchNavHistory(f.code, fetchImpl);
    if (points == null) {
      log(`${f.code} ${f.name} 抓取失败（远端不可用或超时）`);
      pending.add(f.id);
      return;
    }
    let inserted = 0;
    for (const p of points) {
      if (nav.insertIgnore(f.id, p.date, p.unitNav)) inserted += 1;
    }
    if (nav.hasDate(f.id, expected)) {
      pending.delete(f.id);
      log(`${f.code} ${f.name} 同步完成：新插入 ${inserted} 条（期望日期 ${expected} 已入库）`);
    } else {
      pending.add(f.id);
      log(`${f.code} ${f.name} 已抓取 ${points.length} 条（新插入 ${inserted}），期望日期 ${expected} 尚未公布`);
    }
  };

  const runAll = async (): Promise<void> => {
    const expected = expectedLatestNavDate(nowFn());
    const funds = watch.list();
    for (const [i, f] of funds.entries()) {
      if (i > 0) await sleep(FUND_INTERVAL_MS);
      await syncFund(f, expected);
    }
  };

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    if (ownNav) nav.close();
    if (ownWatch) watch.close();
  };

  const done = runAll().then(() => {
    // 无需轮询（20:00 前只抓一次，或全部已入库）→ 直接释放连接
    if (!canRetry || pending.size === 0) {
      stop();
      return;
    }
    // 20:00 后当日净值未公布 → 每小时轮询；全部入库或跨日则停止
    timer = setInterval(() => {
      if (fmtDate(nowFn()) !== startupDay) {
        log('已跨日，停止当日净值轮询（下次启动重新判断）');
        stop();
        return;
      }
      void runAll().then(() => {
        if (pending.size === 0) {
          log('当日净值已全部入库，停止轮询');
          stop();
        }
      });
    }, opts?.retryIntervalMs ?? RETRY_INTERVAL_MS);
    timer.unref?.();
  });

  return { done, stop };
}
