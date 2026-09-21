# 本地服务设计（server/）

> 状态：骨架已实施。本文档为该组件的独立维护文档，后续变更**先改此处再动代码**。

## 1. 定位

被动数据与查询服务：`127.0.0.1:17521`，管理页静态托管 + 数据 API（当前仅 `/api/health`）。扩展与管理页均为客户端，服务不主动驱动浏览器。

## 2. 技术选型与运行方式

- **TypeScript + Node 原生 type stripping**：要求 **Node ≥22.18**（本机 24.x）。源码即运行时（`node src/server.ts`），零构建、零产物入库、**零运行时 npm 依赖**（`node:http`；后续数据存储用 `node:sqlite`）。约束：仅 erasable 语法（不用 enum/namespace/参数属性）；import 必须带 `.ts` 扩展；类型检查只在开发期 `npm run check`（tsc --noEmit + vitest，devDeps：typescript / @types/node / vitest，**npm install 不是运行前提**）。
- `package.json` 显式 `"type": "module"`——否则 `.ts` 按 CJS 解析直接崩溃。

## 3. 结构（按 feature 组织，对齐 video-assistant server）

```
├── DESIGN.md
├── native-host.ts        # Native messaging 引导 host（见 §6）
├── native-host.cmd       # host 启动器（注册表指向它）
├── install-native.ps1/.bat   # 生成 host manifest + 写 HKCU 注册表（一次性）
├── uninstall-native.bat  # 卸载 native host
├── start.bat             # 手动启动兜底（双击）
├── public/               # 管理页构建产物（../server-web 直出，随仓库提交）
└── src/
    ├── server.ts         # 入口：createApp().listen(127.0.0.1:17521) + 启动日志
    ├── app.ts            # createApp()：极简路由表（method+pattern+handler，零框架）分发、
    │                     #   静态服务兜底、写操作 Origin 守卫、异常→JSON
    ├── lib/              # 共享基础设施（无业务语义）
    │   ├── http.ts       # json() / readJson() / asRecord() / HttpError / streamFile() / Route 类型
    │   ├── paths.ts      # SERVER_ROOT 锚定（src/lib/ → server/）
    │   └── static.ts     # public/ 静态服务（MIME 表 + 防路径穿越）
    ├── features/
    │   └── system/       # 系统级接口：GET /api/health
    └── test/setup.ts     # 全局测试 setup（后续 SQLite 在此切内存库）
```

新模块（基金数据、净值、持仓、提醒配置等）各自成目录（routes/types/…），挂进 `app.ts` 的 ROUTES。

## 4. 路由与安全

- 路径匹配：段精确相等；`:x` 段为参数占位。
- 仅监听 `127.0.0.1`。
- 写操作（POST/PUT）校验 Origin：本机管理页 + vite 开发服（`localhost:5173` / `127.0.0.1:5173`）+ `chrome-extension://`（扩展 id 待首个构建加载后锁定白名单）；无 Origin（curl 等）放行。
- 静态服务归一化路径限制在 `public/` 内，防路径穿越。

## 5. 启动

- **扩展一键拉起（推荐）**：面板状态卡片离线时点击 → native messaging 引导（见 §6，需先安装 host）。
- **手动兜底**：双击 `start.bat`，或 `cd server && node src/server.ts`（http://127.0.0.1:17521，管理页在根路径）。

管理页产物 `public/` 由 `../server-web` 构建直出并随仓库提交。

## 6. Native messaging 引导（一键启动）

扩展面板无法直接 spawn 进程，启动链路经 Chrome native messaging：

```
面板(离线点击) ──sendNativeMessage('com.fund.assistant', {cmd:'start'})──▶ native-host.cmd
                                                                          │ 读一条消息（4 字节小端长度前缀 + JSON）
                                                                          │ detached spawn node src/server.ts（stdio → server.log）
                                                                          ▼
                                              回 {ok:true, pid} 后 host 即退 ◀── 服务独立存活，面板轮询 /api/health 确认上线（≤10s）
```

- `native-host.ts`：一次性引导 host，只认 `cmd:'start'`，其余回 `{ok:false, error:'unknown cmd'}`。
- `install-native.ps1`（或双击 `install-native.bat`）：生成 `com.fund.assistant.json`（type=stdio，path 指向 `native-host.cmd`，`allowed_origins` 锁定扩展 id）并写 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fund.assistant`（HKCU 无需管理员）。安装产物 `.json` 与 `server.log` 不入库。
- **安全边界**：`allowed_origins` 只允许本扩展；host 不接受除 start 外的任何指令；服务仅监听 127.0.0.1。
- 扩展 id：dist/ 目录路径不变则 id 稳定；换路径/换机重装后需 `pwsh install-native.ps1 -ExtensionId <新id>`。
