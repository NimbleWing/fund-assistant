// 服务入口：createApp().listen。启动方式见 DESIGN.md §5。
import { createApp, HOST, PORT } from './app.ts';

const server = createApp();
server.listen(PORT, HOST, () => {
  console.log(`[fund-server] http://${HOST}:${PORT} （管理页 http://${HOST}:${PORT}/）`);
});
