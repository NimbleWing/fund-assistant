# fund-assistant

基金助手 —— 三组件仓库（架构对齐 video-assistant）：

| 组件 | 位置 | 说明 |
|------|------|------|
| Chrome 扩展本体 | `src/` + `manifest.json`（TS，产物 `dist/`） | MV3 侧边栏面板，当前为骨架 |
| 本地服务 | `server/` | Node 零依赖 TS 服务，`127.0.0.1:17521` |
| 管理页前端 | `server-web/` | React + Tailwind，产物直出 `server/public` |

开发：各组件目录 `npm install && npm run check`；扩展「加载解包」选 `dist/`。详见 `AGENTS.md` 与各组件文档（`EXTENSION.md`、`server/DESIGN.md`、`server-web/DESIGN.md`）。
