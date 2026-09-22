// 后台 Service Worker：点击工具栏图标打开侧边栏；后续任务调度（定时拉取、提醒）在此挂载。
import { logger } from './core/logger.ts';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e: unknown) => logger.warn('setPanelBehavior 失败', e));

logger.info('后台启动');
