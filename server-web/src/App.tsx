import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Layout } from '@/components/Layout';
import { fetchHealth } from '@/lib/api';
import { Status } from '@/features/Status/Status';
import { Records } from '@/features/Records/Records';
import { Timeline } from '@/features/Timeline/Timeline';
import { Funds } from '@/features/Funds/Funds';
import { Watchlist } from '@/features/Watchlist/Watchlist';
import { FundDetail } from '@/features/FundDetail/FundDetail';
import { Rounds } from '@/features/Rounds/Rounds';
import { ClosedRounds } from '@/features/Rounds/ClosedRounds';
import type { WatchRow } from '@/lib/api';

// 应用外壳（对齐 video-assistant）：Layout 顶栏 + 侧边栏页签（服务状态 / 买卖分析 / 过程回放 / 基金搜索 / 关注列表 / 当前轮次 / 已清仓轮次），
// 服务心跳轮询（10s）结果显示于顶栏 headerExtra。
type Tab = 'status' | 'records' | 'timeline' | 'funds' | 'watchlist' | 'rounds' | 'closedRounds';

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
  {
    key: 'timeline',
    label: '过程回放',
    icon: icon(
      <>
        <path d="M4 19.5V4.5" />
        <path d="M4 19.5h16" />
        <path d="M7 15l3.5-4.5 3 3L19 7" />
      </>,
    ),
  },
  {
    key: 'funds',
    label: '基金搜索',
    icon: icon(
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </>,
    ),
  },
  {
    key: 'watchlist',
    label: '关注列表',
    icon: icon(
      <>
        <path d="M12 4.5l2.2 4.6 5 .6-3.7 3.4 1 4.9-4.5-2.5-4.5 2.5 1-4.9L4.8 9.7l5-.6z" />
      </>,
    ),
  },
  {
    key: 'rounds',
    label: '当前轮次',
    icon: icon(
      <>
        <path d="M4.5 8a8 8 0 0 1 14-3.5M19.5 16a8 8 0 0 1-14 3.5" />
        <path d="M18.5 1.5v3.5H15M5.5 22.5V19H9" />
      </>,
    ),
  },
  {
    key: 'closedRounds',
    label: '已清仓轮次',
    icon: icon(
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
      </>,
    ),
  },
] as const satisfies readonly { key: Tab; label: string; icon: ReactNode }[];

export default function App() {
  const [tab, setTab] = useState<Tab>('status');
  const [selectedFund, setSelectedFund] = useState<WatchRow | null>(null);
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
      onTabChange={(t) => {
        setTab(t);
        setSelectedFund(null); // 切页签时退出基金详情页
      }}
    >
      {selectedFund ? (
        <FundDetail fund={selectedFund} onBack={() => setSelectedFund(null)} />
      ) : (
        <>
          {tab === 'status' && <Status online={online} service={service} onRefresh={() => void refresh()} />}
          {tab === 'records' && <Records />}
          {tab === 'timeline' && <Timeline />}
          {tab === 'funds' && <Funds />}
          {tab === 'watchlist' && <Watchlist onOpenFund={setSelectedFund} />}
          {tab === 'rounds' && <Rounds />}
          {tab === 'closedRounds' && <ClosedRounds />}
        </>
      )}
    </Layout>
  );
}
