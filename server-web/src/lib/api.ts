// 服务 API 客户端：统一超时与错误归一（开发服下 /api 由 vite 代理到本地服务）。
export interface HealthInfo {
  ok: boolean;
  service: string;
}

export async function fetchHealth(timeoutMs = 2000): Promise<HealthInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as HealthInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
