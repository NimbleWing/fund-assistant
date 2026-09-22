// 侧边栏面板入口：版本展示 + 本地服务状态卡片（含重启按钮）+ 持仓估值区块。
// 交互语义（对齐 video-assistant）：在线点击卡片 = 新标签页打开管理页；离线点击卡片 = native messaging 拉起本地服务；
// 在线时点「重启」按钮 = native messaging 重启本地服务。
import { SERVER_ORIGIN } from '../core/config.ts';
import { checkHealth, type HealthResult } from '../core/health.ts';
import { restartServer, startServer } from '../core/server-ctl.ts';
import { fetchHoldingEstimates, type HoldingEstimate } from '../core/holdings.ts';

const versionEl = document.getElementById('version') as HTMLElement;
const dotEl = document.getElementById('dot') as HTMLElement;
const textEl = document.getElementById('status-text') as HTMLElement;
const cardEl = document.getElementById('status-card') as HTMLElement;
const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const holdingsEl = document.getElementById('holdings') as HTMLElement;
const holdingsListEl = document.getElementById('holdings-list') as HTMLElement;
const holdingsTimeEl = document.getElementById('holdings-time') as HTMLElement;

versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(msg: string, ms = 1800): void {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}
// native 启动/重启进行中标记：期间心跳轮询不覆盖卡片文案
let busy = false;

function renderBusy(label: string): void {
  dotEl.classList.remove('online', 'err');
  restartBtn.hidden = true;
  textEl.textContent = label;
}

function render(r: HealthResult): void {
  dotEl.classList.toggle('online', r.online);
  dotEl.classList.toggle('err', !r.online);
  restartBtn.hidden = !r.online;
  textEl.textContent = r.online ? `服务在线 · ${r.latencyMs ?? '?'}ms` : '服务离线 · 点击启动';
}

function signed(v: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

function trendCls(v: number): string {
  return v > 0 ? 'up' : v < 0 ? 'down' : '';
}

function renderHoldingRow(item: HoldingEstimate): HTMLLIElement {
  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'h-name';
  name.textContent = item.name;
  name.title = `${item.name}（${item.code}）`;

  const pct = document.createElement('span');
  const amt = document.createElement('span');
  pct.className = 'h-pct';
  amt.className = 'h-amt';
  if (item.estChangePct === null || item.estChangeAmount === null) {
    pct.textContent = '--';
    amt.textContent = '--';
    pct.classList.add('na');
    amt.classList.add('na');
  } else {
    pct.textContent = `${signed(item.estChangePct)}%`;
    amt.textContent = signed(item.estChangeAmount);
    pct.classList.add(trendCls(item.estChangePct));
    amt.classList.add(trendCls(item.estChangeAmount));
  }

  li.append(name, pct, amt);
  return li;
}

// 持仓估值：服务不可达（null）或无持仓时隐藏区块；估值时间取各行最新一条。
async function refreshHoldings(): Promise<void> {
  const list = await fetchHoldingEstimates();
  if (!list || list.length === 0) {
    holdingsEl.hidden = true;
    return;
  }
  holdingsListEl.replaceChildren(...list.map(renderHoldingRow));
  const times = list.map((i) => i.gztime).filter((t): t is string => t !== null);
  holdingsTimeEl.textContent = times.length > 0 ? `估值时间 ${times.sort().at(-1)}` : '';
  holdingsEl.hidden = false;
}

async function refresh(): Promise<void> {
  if (busy) return;
  textEl.textContent = '检测中…';
  const r = await checkHealth();
  render(r);
  if (r.online) void refreshHoldings();
  else holdingsEl.hidden = true;
}

void refresh();
setInterval(() => void refresh(), 30_000);

cardEl.addEventListener('click', async () => {
  const current = await checkHealth();
  if (current.online) {
    chrome.tabs.create({ url: `${SERVER_ORIGIN}/` });
    return;
  }
  if (busy) return;
  busy = true;
  renderBusy('启动中…');
  toast('正在启动本地服务…', 5000);
  const res = await startServer();
  busy = false;
  if (res.online) toast('本地服务已启动');
  else toast(`启动失败：${res.error ?? '未知错误'}（可手动运行 server/start.bat）`, 6000);
  await refresh();
});

// 重启按钮：阻止冒泡避免触发卡片点击；重启期间隐藏持仓估值区块
restartBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (busy) return;
  busy = true;
  renderBusy('重启中…');
  holdingsEl.hidden = true;
  toast('正在重启本地服务…', 5000);
  const res = await restartServer();
  busy = false;
  if (res.online) toast('本地服务已重启');
  else toast(`重启失败：${res.error ?? '未知错误'}（可手动运行 server/start.bat）`, 6000);
  await refresh();
});
