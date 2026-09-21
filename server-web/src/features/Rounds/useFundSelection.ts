// 当前轮次页 / 已清仓轮次页共用的基金选择：拉取关注列表，默认选中第一只。
import { useEffect, useState } from 'react';
import { fetchWatchlist, type WatchRow } from '@/lib/api';

export function useFundSelection(): { funds: WatchRow[]; fundCode: string; setFundCode: (code: string) => void } {
  const [funds, setFunds] = useState<WatchRow[]>([]);
  const [fundCode, setFundCode] = useState('');

  useEffect(() => {
    void fetchWatchlist().then((d) => {
      const rows = d?.ok && d.rows ? d.rows : [];
      setFunds(rows);
      if (rows.length > 0) setFundCode((prev) => prev || (rows[0]?.code ?? ''));
    });
  }, []);

  return { funds, fundCode, setFundCode };
}
