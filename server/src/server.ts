// 服务入口：createApp().listen。启动方式见 DESIGN.md §5。
// listen 成功后异步同步关注基金净值（nav feature，20:00 后未公布会每小时轮询；详见 DESIGN.md §10），
// 并启动预估净值固化调度（交易日 16:00 后抓盘中估值落库；详见 DESIGN.md §10）。
import { createApp, HOST, PORT } from './app.ts';
import { startEstNavSync, startNavSync } from './features/nav/index.ts';

const server = createApp();
server.listen(PORT, HOST, () => {
  console.log(`[fund-server] http://${HOST}:${PORT} （管理页 http://${HOST}:${PORT}/）`);
  startNavSync();
  startEstNavSync();
});
