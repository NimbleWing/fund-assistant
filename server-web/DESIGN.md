# 管理页前端设计（server-web/）

> 状态：骨架已实施（布局与主题对齐 video-assistant）。本文档为该组件的独立维护文档，后续变更**先改此处再动代码**。

## 1. 定位

React 19 + TypeScript strict + Tailwind CSS v4 + Vite + Vitest，独立 npm 包；构建产物直出 `../server/public`（文件名不带哈希，随仓库提交，服务零依赖开箱即用）。

## 2. 布局与主题（对齐 video-assistant）

- **主题令牌**（`styles.css` `@theme`）：暗色调色板 `bg/surface/raised/line/ink/dim`、状态色 `ok/warn/err`、品牌色**靛蓝**（`brand #818cf8` 系，与扩展图标 sky→indigo 渐变一致）；涨跌语义 `up/down`（A 股习惯：红盈绿亏）。
- **组件类**（`@layer components`）：`.card` / `.act(.act-primary)` / `.side-item` / 全局 table / `.badge-*` / `.chip` / dialog。
- **Layout**（`components/Layout/`）：顶栏（标题 + headerExtra + 移动端菜单 + 收合按钮）+ 左侧侧边栏（桌面可收合 rail，localStorage 记忆 `side-nav-collapsed`；移动端 off-canvas 抽屉）+ 内容区；side-foot 显示服务地址。

## 3. 结构

```
src/
├── main.tsx                      # 入口（StrictMode + createRoot）
├── App.tsx                       # 外壳：Layout + 侧边栏页签（服务状态 / 买卖分析）+ 心跳轮询（10s，结果显示于顶栏）
├── components/
│   └── Layout/                   # 页面骨架（顶栏 + 侧边栏 + 内容区）
├── features/
│   ├── Status/                   # 服务状态页（心跳徽标 + 手动刷新）
│   ├── Records/                  # 临时分析页：双口径（逐笔配对 + 摊薄成本）汇总卡、最新净值输入（localStorage 记忆，默认最后卖出净值；持有行联动显示逐笔浮动盈亏）、回本净值、配对表（红盈绿亏；未匹配卖出/份额异常黄色警示）
│   └── Timeline/                 # 过程回放页：播放器（播放/步进/拖拽/倍速）+ 当前笔卡片 + 六状态卡 + SVG 走势图（净值线 + 摊薄均价虚线，买▲卖▼，光标右侧淡出；数据源 timeline 字段，纯手绘无第三方库）
├── lib/api.ts                    # API 客户端（超时归一，fetch 走 /api 同源/代理）
├── styles.css                    # @import "tailwindcss" + @theme 令牌 + 组件类
└── test/setup.ts                 # React act 环境
```

后续常驻 feature（净值、持仓、提醒配置…）以 `src/features/` + 侧边栏页签形式挂载进 `App.tsx`。

## 4. 命令

- `npm run dev`：Vite 开发服（热更；`/api` 代理到 `127.0.0.1:17521`）。
- `npm run check`：typecheck + test + build（提交前必跑，产物直出 `../server/public`）。

## 5. 测试策略

vitest + happy-dom + @testing-library/react；网络用 `vi.stubGlobal('fetch', …)` 模拟，行为断言用 `findBy*` 等待异步状态；Layout 单测覆盖选中态/收合持久化/无 tabs 降级。
