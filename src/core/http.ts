// 共享的带超时 JSON GET 封装（panel 侧各 core 聚合模块复用）；非 2xx 抛错由调用方兜底。

/** 带超时的 JSON GET；非 2xx 抛 Error。 */
export async function getJson<T>(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
