// 常量收敛：本地服务地址与 native messaging host 名（均对应 server/ 组件，见 server/DESIGN.md）。
export const SERVER_ORIGIN = 'http://127.0.0.1:17521';
export const NATIVE_HOST = 'com.fund.assistant';
// 面板「重载」旗标（storage.session）：重载前插入，SW 启动后消费并自动重开侧边栏
export const RELOAD_FLAG_KEY = 'reloadOpenPanel';
