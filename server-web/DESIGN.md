# 管理页前端设计（server-web/）

> 状态：骨架已实施。本文档为该组件的独立维护文档，后续变更**先改此处再动代码**。

## 1. 定位

React 19 + TypeScript strict + Tailwind CSS v4 + Vite + Vitest，独立 npm 包；构建产物直出 `../server/public`（文件名不带哈希，随仓库提交，服务零依赖开箱即用）。

## 2. 结构

```
src/
├── main.tsx            # 入口（StrictMode + createRoot）
├── App.tsx             # 应用外壳：标题 + 服务状态卡片（10s 轮询 /api/health）
├── lib/api.ts          # API 客户端（超时归一，fetch 走 /api 同源/代理）
├── styles.css          # @import "tailwindcss"
└── test/setup.ts       # React act 环境
```

后续 feature（净值、持仓、提醒配置…）以 `src/features/` 目录 + 页签形式挂载进 `App.tsx`。

## 3. 命令

- `npm run dev`：Vite 开发服（热更；`/api` 代理到 `127.0.0.1:17521`）。
- `npm run check`：typecheck + test + build（提交前必跑，产物直出 `../server/public`）。

## 4. 测试策略

vitest + happy-dom + @testing-library/react；网络用 `vi.stubGlobal('fetch', …)` 模拟，行为断言用 `findBy*` 等待异步状态。
