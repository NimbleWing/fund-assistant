// native 启动编排单测：注入 send/check/wait，覆盖 成功上线 / host 拒绝 / 超时 三条路径。
import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/core/server-ctl.ts';
import type { HealthResult } from '../../src/core/health.ts';

const wait = vi.fn(async () => {});

describe('startServer', () => {
  it('成功：host 应答 ok，轮询至上线', async () => {
    const results: HealthResult[] = [{ online: false }, { online: false }, { online: true }];
    const check = vi.fn(async () => results.shift() as HealthResult);
    const r = await startServer({
      send: async () => ({ ok: true, pid: 123 }),
      check: check as unknown as () => Promise<HealthResult>,
      wait,
    });
    expect(r.online).toBe(true);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('host 拒绝/无应答：直接失败并透出 error', async () => {
    const check = vi.fn(async () => ({ online: true }) as HealthResult);
    const r = await startServer({
      send: async () => ({ ok: false, error: 'native host 无应答' }),
      check,
      wait,
    });
    expect(r.online).toBe(false);
    expect(r.error).toBe('native host 无应答');
    expect(check).not.toHaveBeenCalled();
  });

  it('10 次轮询均未上线：超时失败', async () => {
    const check = vi.fn(async () => ({ online: false }) as HealthResult);
    const r = await startServer({ send: async () => ({ ok: true, pid: 1 }), check, wait });
    expect(r.online).toBe(false);
    expect(r.error).toBe('服务未在 10 秒内上线');
    expect(check).toHaveBeenCalledTimes(10);
  });
});
