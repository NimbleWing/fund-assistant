// 服务状态页：心跳卡片（状态徽标 + 服务名 + 手动刷新）。
interface StatusProps {
  online: boolean | null;
  service: string;
  onRefresh: () => void;
}

export function Status({ online, service, onRefresh }: StatusProps) {
  const badge =
    online == null ? (
      <span className="badge badge-dim">检测中</span>
    ) : online ? (
      <span className="badge badge-ok">在线</span>
    ) : (
      <span className="badge badge-err">离线</span>
    );

  return (
    <div className="card flex items-center gap-4 p-5">
      {badge}
      <div className="min-w-0">
        <p className="font-medium">本地服务 127.0.0.1:17521</p>
        <p className="mt-0.5 text-[13px] text-dim">{online ? service || 'fund-server' : '未运行——可在扩展面板点击状态卡片启动'}</p>
      </div>
      <button type="button" className="act ml-auto shrink-0" onClick={onRefresh}>
        刷新
      </button>
    </div>
  );
}
