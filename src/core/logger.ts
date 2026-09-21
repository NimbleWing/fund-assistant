// 统一前缀日志：便于 Service Worker / 面板的 console 输出区分来源。
const TAG = '[fund-assistant]';

export const logger = {
  info: (...args: unknown[]) => console.log(TAG, ...args),
  warn: (...args: unknown[]) => console.warn(TAG, ...args),
  error: (...args: unknown[]) => console.error(TAG, ...args),
};
