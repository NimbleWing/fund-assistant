// A股交易时段判断（本地时间）：工作日 9:30–11:30 / 13:00–15:00 连续竞价为开盘中，其余休市。
// 节假日不识别（与 nav 启动同步约定一致，见 DESIGN.md §10）。

/** 判断给定时刻是否处于开盘时段（仅按本地时间，不含节假日）。 */
export function isMarketOpen(now: Date): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  // 9:30–11:30 / 13:00–15:00（15:00 整点视为已收盘）
  return (t >= 9 * 60 + 30 && t < 11 * 60 + 30) || (t >= 13 * 60 && t < 15 * 60);
}

/** 开休市展示文案。 */
export function marketLabel(now: Date): string {
  return isMarketOpen(now) ? '开盘中' : '休市';
}
