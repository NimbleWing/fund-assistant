import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '@/lib/api';

// 应用外壳：标题 + 服务状态卡片（10s 轮询 /api/health）。后续 feature 以页签形式挂载。
type Status = 'checking' | 'online' | 'offline';

export function App() {
  const [status, setStatus] = useState<Status>('checking');
  const [service, setService] = useState('');

  const refresh = useCallback(async () => {
    const health = await fetchHealth();
    setStatus(health?.ok ? 'online' : 'offline');
    setService(health?.service ?? '');
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold text-neutral-800">基金助手 · 管理页</h1>
      <p className="mt-1 text-sm text-neutral-500">本地服务 127.0.0.1:17521</p>
      <section className="mt-6 flex items-center gap-3 rounded-xl border border-neutral-200 p-4">
        <span
          className={`h-3 w-3 rounded-full ${
            status === 'online' ? 'bg-emerald-500' : status === 'offline' ? 'bg-red-500' : 'bg-neutral-300'
          }`}
          aria-hidden
        />
        <div>
          <p className="font-medium text-neutral-800">
            {status === 'checking' ? '检测中…' : status === 'online' ? '服务在线' : '服务离线'}
          </p>
          {status === 'online' && service && <p className="text-sm text-neutral-500">{service}</p>}
        </div>
        <button
          className="ml-auto rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
          onClick={() => void refresh()}
        >
          刷新
        </button>
      </section>
    </main>
  );
}
