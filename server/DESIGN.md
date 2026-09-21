# 本地服务设计（server/）

> 状态：骨架已实施。本文档为该组件的独立维护文档，后续变更**先改此处再动代码**。

## 1. 定位

被动数据与查询服务：`127.0.0.1:17521`，管理页静态托管 + 数据 API（当前仅 `/api/health`）。扩展与管理页均为客户端，服务不主动驱动浏览器。

## 2. 技术选型与运行方式

- **TypeScript + Node 原生 type stripping**：要求 **Node ≥22.18**（本机 24.x）。源码即运行时（`node src/server.ts`），零构建、零产物入库、**零运行时 npm 依赖**（`node:http`；数据存储用 `node:sqlite`，见 §9）。约束：仅 erasable 语法（不用 enum/namespace/参数属性）；import 必须带 `.ts` 扩展；类型检查只在开发期 `npm run check`（tsc --noEmit + vitest，devDeps：typescript / @types/node / vitest，**npm install 不是运行前提**）。
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
    │   ├── system/       # 系统级接口：GET /api/health
    │   ├── records/      # 临时：买卖记录分析（parse.ts 解析配对 + /api/records）
    │   ├── funds/        # 基金实时搜索（/api/funds/search，代理天天基金 suggest，见 §8）
    │   └── watchlist/    # 关注基金列表（SQLite 持久化 + /api/watchlist，见 §9）
    └── test/setup.ts     # 全局测试 setup（后续 SQLite 在此切内存库）
```

新模块（基金数据、净值、持仓、提醒配置等）各自成目录（routes/types/…），挂进 `app.ts` 的 ROUTES。

## 4. 路由与安全

- 路径匹配：段精确相等；`:x` 段为参数占位。
- 仅监听 `127.0.0.1`。
- 写操作（POST/PUT/DELETE）校验 Origin：本机管理页 + vite 开发服（`localhost:5173` / `127.0.0.1:5173`）+ `chrome-extension://`（扩展 id 待首个构建加载后锁定白名单）；无 Origin（curl 等）放行。
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

## 7. 临时 feature：买卖记录分析（records/）

**临时功能**：解析手动维护的仓库根目录 `buyAndSellRecord.txt`（每行 `时间 本金 确认净值 确认份额`，`-` 开头为卖出），`GET /api/records` 返回配对行与汇总。

- `parse.ts` 纯逻辑（无 IO，单测覆盖）：卖出按出现顺序与最早的「未配对且确认份额相等」买入配对（同份额多条时 FIFO）；盈亏 = 份额 × 卖出净值 − 买入本金；未配对买入 = 持有中（pnl null）；配不上的卖出进 `unmatchedSells`。
- 异常检测：买入行份额应 ≈ 本金 ÷ 净值（两位小数舍入误差内），相对偏差 >1% 进 `anomalies`（含按本金/净值推算的份额），管理页黄色警示——防手抖多位数（如 212.28 录成 2122.28）默默算错持有份额。卖出不校验（其本金字段为原买入本金）。
- 双口径：**逐笔配对**（卖出与同份额买入 FIFO 配对，已实现/浮动分开）+ **摊薄成本**（按文件顺序模拟：买入累加成本，卖出按当时平均成本价扣减，已实现盈亏滚入剩余持仓成本——对齐基金 App「持仓收益」）。两口径总盈亏一致：市值 + 累计回款 − 总投入。
- 辅助字段：`totalBuyPrincipal` / `sellProceeds`（累计回款）/ `accountBreakEvenNav`（账户总盈亏归零所需净值）/ `latestSellNav`（最后一条卖出净值，前端「最新净值」默认值）。
- 回放序列 `timeline`：摊薄模拟逐笔产出——每笔交易（明细：方向/时间/净值/金额/份额）+ 该步之后的状态快照（累计投入/摊薄成本/份额/均价/累计回款/本笔与累计已实现盈亏），供管理页「过程回放」页签做交互动画；末步快照与汇总字段一致。
- `routes.ts`：读文件 → `parseRecords`；文件缺失返回 `ok:false`（不抛错）。
- 脏行（字段数 ≠ 4、非数字、空行）跳过；时间仅按文件顺序展示，不解析日期。

## 8. 基金搜索（funds/）

实时模糊搜索（按代码/名称）：`GET /api/funds/search?q=xxx`，**服务端代理**天天基金 suggest 接口（`fundsuggest.eastmoney.com/FundSearchAPI.ashx?m=1&key=`，浏览器直连有跨域问题）。

- `search.ts`：请求远端（超时 5s）+ 响应归一化为 `{code, name, type}`（type 取 `FundBaseInfo.FTYPE`，缺失为 null），上限 20 条；fetch 可注入便于单测 stub。
- 空 q 直接返回空列表（不打远端）；远端失败/超时/响应结构异常返回 `ok:false`（不抛错，对齐 records 风格）。
- 无本地缓存——每次请求实时打远端（用户明确不要全量清单方案）。

## 9. 关注基金列表（watchlist/）

首个持久化功能。存储用 **node:sqlite**（Node 22 内置 `DatabaseSync`，实验性警告可忽略），库文件 `server/fund.db` **随仓库提交**（journal/wal/shm 临时文件不入库）；schema 由 `store.ts` 打开时保证（`CREATE TABLE IF NOT EXISTS`），测试注入 `:memory:` 隔离。

- 表 `watchlist`：`id INTEGER PRIMARY KEY AUTOINCREMENT`、`code TEXT UNIQUE NOT NULL`、`name TEXT NOT NULL`、`type TEXT`、`created_at TEXT`、`updated_at TEXT`、`active INTEGER NOT NULL DEFAULT 1`。
- **取消关注为软删除**（`active=0` + 更新 `updated_at`）：后续将基于关注列表派生每日净值写入任务，取消关注伴随关联清理，硬删除留到该任务落地时一并处理。重复关注幂等：`ON CONFLICT(code)` 复活并刷新 name/type/updated_at。
- 路由：`GET /api/watchlist`（仅 active=1）/ `POST /api/watchlist {code,name,type}`（关注或复活）/ `DELETE /api/watchlist/:code`（软删除）。`lib/http.ts` 的 `Route.method` 含 `'DELETE'`；`app.ts` 的 Origin 写守卫覆盖 POST/PUT/DELETE。
