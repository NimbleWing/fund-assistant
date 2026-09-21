// 服务心跳探测：GET {SERVER_ORIGIN}/api/health，带超时，返回统一状态对象。
// 面板/后台复用；fetch 以参数注入便于测试。
import { SERVER_ORIGIN } from './config.ts';

export interface HealthResult {
  online: boolean;
  latencyMs?: number;
  service?: string;
}

export async function checkHealth(fetchImpl: typeof fetch = fetch, timeoutMs = 2000): Promise<HealthResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetchImpl(`${SERVER_ORIGIN}/api/health`, { signal: ctrl.signal });
    if (!res.ok) return { online: false };
    const data = (await res.json()) as { service?: string };
    return { online: true, latencyMs: Date.now() - start, service: data.service };
  } catch {
    return { online: false };
  } finally {
    clearTimeout(timer);
  }
}
