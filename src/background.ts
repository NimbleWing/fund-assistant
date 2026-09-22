// 后台 Service Worker：点击工具栏图标打开侧边栏；面板重载后自动重开侧边栏；后续任务调度（定时拉取、提醒）在此挂载。
import { RELOAD_FLAG_KEY } from './core/config.ts';
import { logger } from './core/logger.ts';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e: unknown) => logger.warn('setPanelBehavior 失败', e));

// 面板「重载」后自动重开侧边栏：重载前 panel 插旗（storage.session），此处消费（一次性）
async function reopenPanelAfterReload(): Promise<void> {
  const stored = (await chrome.storage.session.get(RELOAD_FLAG_KEY)) as Record<string, unknown>;
  if (!stored[RELOAD_FLAG_KEY]) return;
  await chrome.storage.session.remove(RELOAD_FLAG_KEY);
  const win = await chrome.windows.getLastFocused();
  if (win.id === undefined) return;
  await chrome.sidePanel.open({ windowId: win.id }).catch((e: unknown) => logger.warn('重开侧边栏失败', e));
}

void reopenPanelAfterReload();

logger.info('后台启动');
