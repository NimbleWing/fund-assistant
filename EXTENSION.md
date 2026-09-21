# 扩展本体（根目录）

> 状态：骨架已实施。本文档为扩展组件的独立维护文档，后续变更**先改此处再动代码**。

## 1. 定位

MV3 扩展：侧边栏面板承载 UI，后台 Service Worker 负责调度。当前为骨架（版本展示 + 本地服务心跳），基金数据解析、展示与提醒功能以此为基础挂载。

## 2. 目录结构

```
├── manifest.json            # MV3 清单（路径均指向 dist/ 内的构建产物）
├── icons/                   # 图标源（tools/generate-icons.ps1 生成，构建时复制进 dist/）
├── src/
│   ├── background.ts        # SW 入口：点击工具栏图标打开侧边栏；后续任务调度在此挂载
│   ├── core/                # 无业务语义的共享模块
│   │   ├── config.ts        # 常量收敛（本地服务地址、native host 名）
│   │   ├── logger.ts        # 统一前缀日志
│   │   ├── health.ts        # 服务心跳探测（注入 fetch，可测）
│   │   └── server-ctl.ts    # native messaging 启动编排（注入 send/check/wait，可测）
│   └── panel/               # 侧边栏面板（html / css / ts）
├── tests/                   # vitest（镜像 src 结构）
└── tools/
    ├── build.mjs            # esbuild 构建脚本（bundle → dist/ + 复制静态资源）
    └── generate-icons.ps1   # 图标生成（pwsh tools/generate-icons.ps1）
```

## 3. 构建与加载

- `npm run build`：esbuild bundle（ESM，target chrome120）`src/background.ts` → `dist/background.js`、`src/panel/panel.ts` → `dist/panel.js`，并复制 `manifest.json`、`icons/`、`panel.html`、`panel.css` 到 `dist/`。产物 `dist/` 不入库。
- `npm run watch`：同上但监听 TS 变更自动重建（html / css / manifest / icons 变更需重跑 build）。
- Chrome「加载解包的扩展程序」选择 **`dist/`** 目录。
- 代码变更后：`npm run build` → chrome-devtools MCP `reload_extension` 重载（id 用 `list_extensions` 查询）。

## 4. 技术约定

- TypeScript strict + JSDoc 风格中文注释；import 一律带 `.ts` 扩展（allowImportingTsExtensions）。
- 正确性检查靠 `tsc --noEmit`（noUnusedLocals / noUnusedParameters 等），暂不引 eslint；需要时再评估。
- 扩展本体**零运行时 npm 依赖**（与 video-assistant 一致），新增能力优先用 Web/Chrome 原生 API。
- 纯逻辑放 `core/`（注入依赖、可单测）；页面逻辑放 `panel/`（薄壳，尽量少测 DOM）。

## 5. 面板状态卡片与一键启动

- `panel.ts` 加载即探测 `{SERVER_ORIGIN}/api/health`（2s 超时，实现在 `core/health.ts`），30s 轮询；探测/启动期间不重复触发。
- **交互语义**（对齐 video-assistant）：
  - **在线**点击卡片 → 新标签页打开管理页（`chrome.tabs.create`，无需 tabs 权限）；
  - **离线**点击卡片 → `core/server-ctl.ts` 的 `startServer()`：`chrome.runtime.sendNativeMessage('com.fund.assistant', {cmd:'start'})` → host detached 拉起服务 → 每秒心跳轮询确认上线（≤10s）。
- 启动前置：**先运行 `server/install-native.bat` 安装 native messaging host**（一次性，见 `server/DESIGN.md` §6）；未安装时点击离线卡片会 toast 提示失败原因（含手动 `server/start.bat` 兜底）。
- 面板享有 host_permissions 豁免，可直连本地服务；提示统一走 `#toast`（底部浮层）。

## 6. 版本号

功能/修复变更必须升版本号：`manifest.json` 与根 `package.json` 保持一致（补丁 0.1.0→0.1.1，新功能升次版本 0.2.0），面板版本号读自 manifest。
