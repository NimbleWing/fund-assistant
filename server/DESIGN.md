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
    │   ├── funds/        # 基金实时搜索 + 盘中估值（/api/funds/search、/api/funds/:code/estimate，见 §8）
    │   ├── market/       # 大盘行情：上证指数 + 开休市状态（/api/market/index，见 §12）
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

- `native-host.ts`：一次性引导 host，仅接受 `cmd:'start'`（拉起服务）与 `cmd:'restart'`（`netstat` 查 17521 监听 PID → `taskkill /F` → 轮询确认端口释放 ≤2s → 重新拉起，回 `{ok:true, pid, killed}`），其余回 `{ok:false, error:'unknown cmd'}`。
- `install-native.ps1`（或双击 `install-native.bat`）：生成 `com.fund.assistant.json`（type=stdio，path 指向 `native-host.cmd`，`allowed_origins` 锁定扩展 id）并写 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fund.assistant`（HKCU 无需管理员）。安装产物 `.json` 与 `server.log` 不入库。
- **安全边界**：`allowed_origins` 只允许本扩展；host 不接受除 start/restart 外的任何指令，restart 只杀 17521 端口监听进程；服务仅监听 127.0.0.1。
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

**盘中估值**：`GET /api/funds/:code/estimate`（`estimate.ts`）——服务端代理新浪行情接口（`hq.sinajs.cn/list=fu_{code}`，需 `Referer: finance.sina.com.cn` 头；响应 GBK 编码但仅取数字字段不受影响）。字段位：估值时间/预估净值/最新净值（盘中即昨收）/预估涨跌幅%/日期，归一化为 `{gsz 预估净值, gszzl 预估涨跌幅%（相对昨收）, dwjz 最新净值, gztime 估值时间 YYYY-MM-DD HH:mm}`。5s 超时；code 须在关注列表（否则 404）；QDII 无估值/远端失败/超时返回 `ok:false`（不抛错）。fetch 可注入便于单测 stub。供扩展面板持仓估值区块使用（`EXTENSION.md` §7）。

## 9. 关注基金列表（watchlist/）

首个持久化功能。存储用 **node:sqlite**（Node 22 内置 `DatabaseSync`，实验性警告可忽略），库文件 `server/fund.db` **随仓库提交**（journal/wal/shm 临时文件不入库）；schema 由 `store.ts` 打开时保证（`CREATE TABLE IF NOT EXISTS`），测试注入 `:memory:` 隔离。

- 表 `watchlist`：`id INTEGER PRIMARY KEY AUTOINCREMENT`、`code TEXT UNIQUE NOT NULL`、`name TEXT NOT NULL`、`type TEXT`、`created_at TEXT`、`updated_at TEXT`、`active INTEGER NOT NULL DEFAULT 1`。
- **取消关注为软删除**（`active=0` + 更新 `updated_at`）：后续将基于关注列表派生每日净值写入任务，取消关注伴随关联清理，硬删除留到该任务落地时一并处理。重复关注幂等：`ON CONFLICT(code)` 复活并刷新 name/type/updated_at。
- 路由：`GET /api/watchlist`（仅 active=1）/ `POST /api/watchlist {code,name,type}`（关注或复活）/ `DELETE /api/watchlist/:code`（软删除）。`lib/http.ts` 的 `Route.method` 含 `'DELETE'`；`app.ts` 的 Origin 写守卫覆盖 POST/PUT/DELETE。

## 10. 基金净值历史（nav/）

关注基金的单位净值历史落库。术语统一：第三方字段在抓取层归一化为领域术语（`FSRQ`→`date`、`DWJZ`→`unitNav`），库表/接口/前端一律用领域术语（`domain_models/CONTEXT.md`）。

- 数据源：
  - 关注时全量：天天基金 `fund.eastmoney.com/pingzhongdata/{code}.js` 的 `Data_netWorthTrend`（**单请求全量历史**；`x`=北京时间零点毫秒时间戳→`date`、`y`→`unitNav`，`equityReturn` 日涨幅暂不入库）。日期换算用 `x + 8h` 的 UTC 日期，不受服务器时区影响。
  - 启动/轮询补最新：`api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=20`（需 `Referer: fundf10.eastmoney.com` 头，每页上限 20 条）。
- 表 `fund_nav`（fund.db 内）：`id` / `watchlist_id`（逻辑关联 watchlist.id，不启用 FK 约束——SQLite prepare 会校验被引用表存在，跨连接顺序敏感）/ `unit_nav REAL` / `date TEXT`（YYYY-MM-DD）/ `created_at`；`UNIQUE(watchlist_id, date)` 去重。
- **关注即全量写入**：`POST /api/watchlist` 关注（含复活）成功后立即抓取全量历史落库（`INSERT OR IGNORE`），响应带 `navSynced`（插入条数；失败为 null，不影响关注本身）。
- **启动同步**（`server.ts` listen 后异步执行，不阻塞启动）：按「期望净值日期」驱动——**20:00 前**期望上一交易日（周末回退到最近周五，节假日不识别），已入库则跳过，缺失则抓一次（**lsjz 第一页 20 条**，轻量，足以覆盖最近交易日）；**20:00 后**期望当日净值，缺失则立即抓一次，仍未公布则**每小时轮询**，直到当日净值入库或跨日（次日 0 点自动停止，下次启动重新判断）。基金间间隔 500ms 防限流，单只失败仅记日志。
- **手动补录**（兜底，接口故障/数据缺失时用）：`POST /api/funds/:code/nav {date, unitNav}`——code 须在关注列表（含软删除）；该日期已存在时不覆盖，返回 `{ok:true, inserted:false}` 由前端提示；校验 date 格式与 unitNav > 0。
- 查询：`GET /api/funds/:code/navs` → 该基金全部净值（date 倒序），供管理页基金详情页展示。
- 结构：`store.ts`（fund_nav 读写，:memory: 可注入）/ `fetch.ts`（pingzhongdata 拉取 + 归一化，fetch 可注入）/ `sync.ts`（单只同步 `syncFundNav` + 启动同步编排）/ `routes.ts`。

## 11. 轮次（rounds/）

轮（`domain_models/CONTEXT.md`）的录入与跟踪。两表（fund.db 内）：

- `round`：`id` / `fund_code`（关联关注基金）/ `seq`（该基金内从 1 递增）/ `status`（`active` 进行中 / `closed` 已清仓）/ 清仓快照字段（`buy_count` `sell_count` `invested` `proceeds` `realized_pnl` `sold_principal` `total_pnl`，closed 时写入）/ `created_at` `closed_at`。
- `round_txn`：`id` / `round_id` / `direction`（buy/sell）/ `date`（=确认日）/ `amount`（本金/回款）/ `nav`（确认净值）/ `shares`（确认份额）/ `fee`（手续费，仅卖出有意义，默认 0）/ `pair_buy_id`（显式配对的买入交易 id，仅卖出，null = 自动 FIFO）/ `created_at`。存量库打开时自动 ALTER TABLE 补缺失列。

规则：

- 开轮 `POST /api/rounds {fundCode}`：该基金须已关注（active）且无进行中轮。
- 录入 `POST /api/rounds/:id/txns` / 删除 `DELETE /api/rounds/:id/txns/:txnId`：仅进行中轮；卖出份额不得超过当前持有份额；卖出可带 `pairBuyId` 显式配对（须为本轮未清买入，且累计配对份额不超该买入确认份额）；**被显式配对的买入不可删**（需先删对应卖出）。
- 闭轮 `POST /api/rounds/:id/close`：**持有份额须归 0**（否则 400）；快照由服务端按交易重算写入，之后直接读快照。
- `calc.ts` 纯逻辑：逐笔配对**显式配对优先**——卖出带 `pairBuyId` 时优先消耗指定买入批次（按份额比例扣本金），不足部分退回 **FIFO 分批消耗**（允许一次卖出跨多笔买入）；未指定时纯 FIFO。摊薄口径为移动平均（同 records）。指标：买入/卖出次数、总投入、累计回款、已实现盈亏、已卖本金、持有本金、持有份额 + 需最新净值的市值/浮动盈亏/持仓收益·摊薄/总盈亏（无净值记录时为 null）。`openBuyLots()` 复用同一回放输出持有中买入批次（剩余份额/本金）。
- `GET /api/rounds?fund=code`：进行中轮动态计算（最新净值取 fund_nav 该基金最新一条），已清仓轮读快照；返回含各轮交易明细与 `openBuys`（进行中轮的持有中买入批次，前端卖出配对选择用；已清仓轮恒为空）。
- buyAndSellRecord.txt（records 临时页）与轮次互不迁移，各自独立。

## 12. 大盘行情（market/）

上证指数行情 + A股开休市状态，供扩展面板行情行使用（`EXTENSION.md` §7）。

- `GET /api/market/index` → `{ok, index:{code,name,price,change,changePct}, market:{open,label}}`；行情远端失败返回 `ok:false` 但**仍带 `market` 字段**（开休市由本地时间计算，不依赖远端）。
- `quote.ts`：代理新浪行情 s_ 简式接口（`hq.sinajs.cn/list=s_sh000001`，需 `Referer: finance.sina.com.cn` 头，`rn` 防缓存参数须在 `list` 之前）。响应 GBK 编码、名称字段不可靠（接口固定上证，name 由服务端常量补齐）；仅取数字字段（最新价/涨跌额/涨跌幅%）。5s 超时，失败归一 null。fetch 可注入单测。
- `status.ts`：纯函数 `isMarketOpen(now)`——本地时间工作日 9:30–11:30 / 13:00–15:00 为开盘中，15:00 整点视为已收盘；节假日不识别（与 §10 净值同步约定一致）。
