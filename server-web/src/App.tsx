import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Layout } from '@/components/Layout';
import { fetchHealth } from '@/lib/api';
import { Status } from '@/features/Status/Status';
import { Records } from '@/features/Records/Records';

// 应用外壳（对齐 video-assistant）：Layout 顶栏 + 侧边栏页签（服务状态 / 买卖分析），
// 服务心跳轮询（10s）结果显示于顶栏 headerExtra。
type Tab = 'status' | 'records';

const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {path}
  </svg>
);

const TABS = [
  {
    key: 'status',
    label: '服务状态',
    icon: icon(
      <>
        <path d="M4 12h4l2.5-6 4 12 2.5-6h3" />
      </>,
    ),
  },
  {
    key: 'records',
    label: '买卖分析',
    icon: icon(
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="3" />
        <path d="M8.5 8.5h7M8.5 12.5h7M8.5 16.5h4" />
      </>,
    ),
  },
] as const satisfies readonly { key: Tab; label: string; icon: ReactNode }[];

export default function App() {
  const [tab, setTab] = useState<Tab>('status');
  const [online, setOnline] = useState<boolean | null>(null);
  const [service, setService] = useState('');

  const refresh = useCallback(async () => {
    const health = await fetchHealth();
    setOnline(health?.ok ?? false);
    setService(health?.service ?? '');
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <Layout
      title={
        <>
          <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full bg-brand shadow-[0_0_10px_#818cf8aa]" />
          基金助手
        </>
      }
      headerExtra={online == null ? '检测中…' : online ? `服务在线${service ? ` · ${service}` : ''}` : '服务离线'}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
    >
      {tab === 'status' && <Status online={online} service={service} onRefresh={() => void refresh()} />}
      {tab === 'records' && <Records />}
    </Layout>
  );
}
