# AGENTS.md — 基金助手 Fund Assistant

## 项目定位

仓库由三个组件构成（架构对齐 video-assistant）：

1. **扩展本体**（根目录 `src/` + `manifest.json`，TypeScript + esbuild 构建，产物 `dist/`）：MV3 侧边栏面板，当前为骨架（版本展示 + 本地服务心跳），后续承载基金数据解析、展示与提醒。
2. **本地服务**（`server/`）：Node ≥22.18 零依赖 TS 服务（Node 原生 type stripping 直跑 `.ts`），`127.0.0.1:17521`——数据 API 与管理页静态托管；可经扩展 native messaging 一键拉起（`server/DESIGN.md` §6）。
3. **管理页前端**（`server-web/`）：React + TypeScript + Tailwind CSS + Vite + Vitest 独立 npm 包，构建产物直出 `server/public`（随仓库提交）。

## 组件称呼对照（统一口径）

用户提需求时按下列别名判定目标组件，命中即直接开工，无需再确认：

| 用户说的 | 指向 | 位置 |
|----------|------|------|
| 扩展、扩展本体、助手面板、面板 | Chrome 扩展本体 | 根目录 `src/`、`manifest.json`（产物 `dist/`，加载解包目录选 `dist/`） |
| 服务器、服务、服务端、后端 | 本地服务 | `server/`（`127.0.0.1:17521`） |
| 管理页、管理端、前端、网页 | 管理页前端 | `server-web/`（构建产物直出 `server/public`） |

歧义处理：「前端」默认指 server-web/；「面板」指扩展本体（侧边栏 UI 属于扩展的一部分）。未命中别名的称呼（如「工具」「脚本」）需向用户确认指向。

## 文档地图（三组件各自维护独立文档）

| 组件 | 文档 | 内容 |
|------|------|------|
| 扩展本体 | `EXTENSION.md` | 分层结构、构建链路、面板心跳、开发约定 |
| 本地服务 | `server/DESIGN.md` | 路由/feature 组织、启动方式、安全边界 |
| 管理页前端 | `server-web/DESIGN.md` | 结构、构建/开发流程、测试策略、约定 |
| 领域术语 | `domain_models/CONTEXT.md` | 统一语言（行情/交易/轮/摊薄口径/账户），页面、接口字段、代码标识以此为准 |

本文件只保留跨组件全局约定与命令速查；组件内架构/实施细节变更**先改对应文档再动代码**。

## 常用命令

```bash
# 根目录（扩展本体）
npm run check    # typecheck + test + build（提交前必跑）
npm run build    # esbuild 构建 → dist/（加载解包目录选 dist/）
npm run watch    # esbuild watch（TS 热重建；html/css/manifest/icons 变更需重跑 build）
pwsh tools/generate-icons.ps1   # 重新生成图标（生成后需重跑 build）

# 本地服务（server/ 内执行；TS + Node ≥22.18 原生 type stripping，独立 npm 包）
npm run check        # typecheck + vitest（运行时零依赖，npm install 仅开发期需要）
node src/server.ts   # 启动（http://127.0.0.1:17521，管理页在根路径）；或双击 start.bat
# native messaging 一键启动（一次性安装；扩展首次加载后执行，id 传入或用脚本内默认值）
pwsh server/install-native.ps1 -ExtensionId <扩展id>

# 管理页前端（server-web/ 内执行）
npm run check    # typecheck + test + build（产物直出 ../server/public 并随仓库提交）
npm run dev      # Vite 开发服（热更，/api 代理到 127.0.0.1:17521）
```

## 全局编码约定

- **先方案后实施（交互纪律）**：用户提出需求或问题时，必须先给出解决方案（涉及改动的文件、思路、取舍），经用户确认后再动手实施；不允许未经确认直接改代码。
- **破坏性操作必须先经用户确认（最高优先级规则）**：任何会清空或批量删除数据的操作——不带定向条件的 `DELETE`/TRUNCATE/drop、清空/覆盖用户数据文件、批量删除磁盘文件——**一律先向用户说明影响范围并等确认**。测试收尾清理只允许定向删除本次测试自建数据，需要隔离时优先用独立临时环境。
- **终端命令必须带超时**：执行任何 shell 命令都要设置 timeout（按预期时长给值），超时无反馈即中止退出并向用户回报；禁止无超时阻塞等待。常驻/交互式进程（dev server、服务进程等）不得前台等待——detached 启动后轮询验证。
- 全部组件 TypeScript strict；新增代码必须过对应 `npm run check`。扩展本体暂不引 eslint（tsc strict 已覆盖正确性检查），需要时再评估。
- import 一律带 `.ts` / `.tsx` 扩展（各 tsconfig 已开 allowImportingTsExtensions）。
- 注释与 UI 文案用中文。
- **扩展本体的功能/修复变更必须同步升版本号**：`manifest.json` 与根 `package.json` 保持一致（补丁 0.1.0→0.1.1，新功能升次版本 0.2.0）；面板版本号读自 manifest，无需另改。server / server-web 单独变更不动扩展版本号。
- **扩展版本号/代码变更后必须 `npm run build` 并经 chrome-devtools MCP 重载扩展**：`reload_extension`（扩展 id 用 `list_extensions` 查询），确保浏览器内运行的是最新代码。
- **每次功能/结构性变更必须同步变更对应组件文档**（见文档地图；实施细节变化先改文档再动代码）。
- **每次实施完成并通过 check 校验后，必须询问用户是否提交**，未经确认不 commit。

## 网络访问排障（本机代理）

本机开了系统代理（Clash，**`http://127.0.0.1:7897`**，端口以注册表 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer` 为准；`ProxyOverride` 内的 localhost/内网段不走代理），但 shell 未注入 `HTTP(S)_PROXY` 环境变量——**网络访问失败先怀疑是未走代理**，按下面流程处理：

1. **对比验证**（8s 超时）：
   ```bash
   curl -s -o NUL -w "%{http_code}" --max-time 8 <url>                          # 直连
   curl -s -o NUL -w "%{http_code}" --max-time 8 -x http://127.0.0.1:7897 <url>  # 走代理
   ```
   直连 `000`/超时、代理 `200` → 确认代理问题。
2. **取内容**：webfetch 工具不支持指定代理，改用 bash 的 `curl -x http://127.0.0.1:7897 <url>`；大响应用 `Select-String`/Grep 定位关键段落。
3. **镜像优先**：有国内镜像的官方文档直接走镜像可避开代理（如 `developer.chrome.com` → `developer.chrome.google.cn`）。
4. **代码内 HTTP 请求**（如 server 抓取天天基金/新浪行情）：目标均为国内可直连站点，**默认直连、不依赖代理**，避免本地服务可用性绑定代理在线状态；确需代理的目标再单独评估。
