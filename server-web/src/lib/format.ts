// 展示格式化：金额两位小数、净值四位、带符号盈亏文本与配色类（红盈绿亏）。
export function fmt(n: number): string {
  return n.toFixed(2);
}

export function fmt4(n: number): string {
  return n.toFixed(4);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 带符号金额文本 + up/down 配色类；零灰。 */
export function pnlValue(v: number): { text: string; cls: string } {
  if (v > 0) return { text: `+${v.toFixed(2)}`, cls: 'text-up' };
  if (v < 0) return { text: v.toFixed(2), cls: 'text-down' };
  return { text: '0.00', cls: 'text-dim' };
}

/** 带符号百分比文本 + up/down 配色类；零灰。 */
export function pctValue(v: number): { text: string; cls: string } {
  if (v > 0) return { text: `+${v.toFixed(2)}%`, cls: 'text-up' };
  if (v < 0) return { text: `${v.toFixed(2)}%`, cls: 'text-down' };
  return { text: '0.00%', cls: 'text-dim' };
}
