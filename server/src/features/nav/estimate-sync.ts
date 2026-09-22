// 预估净值固化调度：每个交易日 16:00 后对关注基金抓取新浪盘中估值并落库（fund_est_nav，固化不覆盖）。
// 窗口 16:00–24:00（仅工作日 tick，节假日估值日期为上一交易日，INSERT OR IGNORE 幂等空转）；
// 当日全部固化或确认无估值后收工（后续 tick 空转），跨日自动重置；网络失败当日持续重试。
import { openWatchStore, type WatchStore, type WatchRow } from '../watchlist/store.ts';
import { openNavStore, type NavStore } from './store.ts';
import { fetchEstimateOutcome } from '../funds/estimate.ts';
import type { FetchLike } from '../funds/search.ts';

const TICK_MS = 10 * 60 * 1000;
const CAPTURE_HOUR = 16;
const FUND_INTERVAL_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface EstNavSyncController {
  /** 首轮检查完成的 Promise（测试/观测用） */
  done: Promise<void>;
  stop(): void;
}

export function startEstNavSync(opts?: {
  watchStore?: WatchStore;
  navStore?: NavStore;
  fetchImpl?: FetchLike;
  /** 当前时间源（测试注入固定时刻） */
  now?: () => Date;
  /** 检查间隔（默认 10 分钟，测试传小值） */
  tickMs?: number;
  log?: (msg: string) => void;
}): EstNavSyncController {
  const log = opts?.log ?? ((msg: string) => console.log(`[est-nav-sync] ${msg}`));
  const ownWatch = opts?.watchStore == null;
  const ownNav = opts?.navStore == null;
  const watch = opts?.watchStore ?? openWatchStore();
  const nav = opts?.navStore ?? openNavStore();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const nowFn = opts?.now ?? (() => new Date());

  /** 当日已处理的基金：已固化 / 确认无估值（网络失败不放入，下一 tick 重试） */
  const settled = new Set<number>();
  let day = '';
  let timer: ReturnType<typeof setInterval> | null = null;

  /** 固化窗口：工作日且本地时间 ≥16:00（24 点跨日后自动关闭） */
  const inWindow = (now: Date): boolean => {
    const dow = now.getDay();
    return dow >= 1 && dow <= 5 && now.getHours() >= CAPTURE_HOUR;
  };

  const captureFund = async (f: WatchRow, today: string): Promise<void> => {
    if (nav.hasEstDate(f.id, today)) {
      settled.add(f.id);
      return;
    }
    const o = await fetchEstimateOutcome(f.code, fetchImpl);
    if (o.kind === 'fail') {
      log(`${f.code} ${f.name} 估值抓取失败，下一检查周期重试`);
      return;
    }
    if (o.kind === 'none') {
      settled.add(f.id);
      log(`${f.code} ${f.name} 无盘中估值（QDII 等），当日跳过`);
      return;
    }
    // 以估值源自带日期落库：节假日下午抓到的是上一交易日，已固化则幂等空转
    const date = o.est.gztime.slice(0, 10);
    const inserted = nav.insertEstIgnore(f.id, date, o.est.gsz, o.est.gszzl, o.est.gztime);
    settled.add(f.id);
    if (date === today) log(`${f.code} ${f.name} ${inserted ? `已固化 ${date} 预估净值 ${o.est.gsz}（${o.est.gszzl}%）` : `${date} 已固化过，跳过`}`);
    else log(`${f.code} ${f.name} 估值日期为 ${date}（非当日，节假日/休市），${inserted ? '补固化' : '已固化过'}`);
  };

  const tick = async (): Promise<void> => {
    const now = nowFn();
    const today = fmtDate(now);
    if (today !== day) {
      day = today;
      settled.clear();
    }
    if (!inWindow(now)) return;
    const funds = watch.list().filter((f) => !settled.has(f.id));
    for (const [i, f] of funds.entries()) {
      if (i > 0) await sleep(FUND_INTERVAL_MS);
      await captureFund(f, today);
    }
  };

  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    if (ownNav) nav.close();
    if (ownWatch) watch.close();
  };

  const done = tick().then(() => {
    timer = setInterval(() => void tick(), opts?.tickMs ?? TICK_MS);
    timer.unref?.();
  });

  return { done, stop };
}
