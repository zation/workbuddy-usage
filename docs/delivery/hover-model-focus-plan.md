# Hover 模型聚焦与交互验收框架化 Plan

## 依据与范围

本 Plan 依据 [hover-model-focus-spec.md](./hover-model-focus-spec.md)，其 R1–R11、AC1–AC14 不在此重复。交付包含两部分：两处按模型分色展示的 hover 聚焦（R1–R7 / AC1–AC7），以及交互验收从手写 CDP 脚本迁移到成熟 e2e 框架（R8–R11 / AC8–AC14）。两部分共用同一份样本数据与同一次验收运行，不新增第二套验收机制。

开发者已确认：框架为 **Playwright**、服务形态为 **`npm run build && npm start` 单端口**、**允许首次联网下载浏览器二进制**、**测试用临时数据库并由环境变量指向**、**断言按新框架重写**、**数据库命名为 `database.db` / `database.ts` / `openDatabase` / `databasePath` / `DATABASE_PATH`**。命名重构、`DATABASE_PATH` 实现与全项目术语统一已在前置改动完成并通过 typecheck / test / build；本 Plan 后续任务从验收基础设施与 hover 聚焦功能开始。Spec 已同步订正，需重新确认。

## 现状分析

### 展示层

- 趋势图 option 由纯函数 `buildTrendChartOption(data, metric, ratios)` 生成：柱系列 `id` 为模型业务键，`emphasis.focus: 'series'` 已生效但非聚焦系列走 ECharts 默认 blur（约 0.1）；tooltip formatter 是 HTML 字符串，按当天 >0 模型降序拼行，日期行与「无数据」是独立分支。
- `EChart.tsx` 用 `echarts.init(node)` 后 `setOption(option, true)`，实例只存在于组件 ref 里；`TrendChart.tsx` 只传 option，不传 hover 状态。
- `BreakdownList.tsx` 的「按分组」行由 `visibleSegments` + `segmentWidths` 渲染 `.breakdown-segment`，整行 hover / focus 通过 `activeKey` 浮出 `BreakdownTooltip`；段本身没有事件，浮层 `pointer-events: none`。
- `App.tsx` 两个 tab 的面板 DOM 常驻、未激活者 `hidden`，因此两个 tab 的趋势图与「按分组」列表各自可持有独立状态，天然满足 R5 的视图独立。

### 验收层（旧实现，作为覆盖清单来源）

- `scripts/panel-acceptance.mjs` 是单文件线性流程：Node 内置 WebSocket 自研 CDP 客户端 → `Emulation.setFocusEmulationEnabled` → 固定 `wait()` → 字符串拼接 `Runtime.evaluate` → 自定义 `check()` 打印 24 项 PASS/FAIL。
- 24 项验收覆盖按性质分五类：DOM / ARIA 结构、数值与口径、图表配置与配色、hover / focus 与几何、网络请求。名称清单可从脚本 24 处 `check()` 提取，只作为 AC10 的覆盖对照，**不作为新用例的实现模板**。
- 旧脚本期望值从 `/api` 现场读取、图表断言靠动态 import Vite dev 的 echarts 资源 URL 调 `getOption()`，这两点都是它为「真实数据 + dev 形态」付出的代价，固定样本与 build 形态下都不再沿用。

### 命名与术语统一（前置改动已完成）

- 本项目数据库：文件 `.data/database.db`（原 `.data/index.db`）、模块 `src/etl/database.ts`（原 `index-db.ts`）、`openDatabase` / `closeDatabase`（原 `openIndex` / `closeIndex`）、测试 `tests/database.test.ts`、配置字段 `EtlConfig.databasePath`、可选环境变量 `DATABASE_PATH`（未设置时默认值 `.data/database.db`）。
- 术语：本项目数据库统一叫「数据库」，WorkBuddy 的 `~/.workbuddy/workbuddy.db` 统一叫「WorkBuddy 数据库」；全项目去掉「派生」，原「纯展示派生 / 日期派生 / 派生规则」分别改为「展示层生成 / 日期折算 / 生成规则」等准确说法；表上的 `CREATE INDEX` 仍叫「索引」。
- 文档范围：长期文档与当前交付文档用新名字；未归档历史交付文档只改术语词、保留当时的路径字面；`docs/delivery/v1.0.0/` 归档三份完全不动。

### 环境约束（读代码与实测所得）

1. `server/index.ts` 校验 Node ≥ 24 才启动；当前 shell PATH 首位是 WorkBuddy 托管的 22.22.2，验收命令必须显式使用 Node 24，否则服务直接退出。
2. `resolveEtlConfig()` 的 `databasePath` 默认 `resolve('.data/database.db')`，可由 `DATABASE_PATH` 覆盖；`staticRoot` 仍是 `resolve('dist/web')`，相对进程 cwd。Playwright 的 `webServer.cwd` 虽能改子进程工作目录（官方：*Current working directory of the spawned process, defaults to the directory of the configuration file*），但那会让静态资源找不到、需要额外复制构建产物；用 `DATABASE_PATH` 指向临时数据库更直接，不采用改 cwd。
3. 服务先 `openDatabase` + 首次 `refresh`，再 `serve` 监听端口。所以 webServer 探到端口就绪即可认为首次刷新完成；样本必须在服务进程启动**之前**写好。
4. `App.tsx` 的 `today = todayKey()` 取浏览器 `Date.now()`（UTC+8 折算），服务端不参与「今天」计算；固定样本日期配合冻结浏览器时间即可稳定时间区断言。
5. `vitest.config.ts` 的 include 是 `tests/**/*.test.ts`，`tsconfig.json` 的 include 含 `tests`；把 e2e 用例放 `tests/e2e/*.spec.ts` 可同时做到「不被 Vitest 收集」与「被 typecheck 覆盖」。
6. `tests/helpers/` 已有 `makeTempDir` / `cleanupTempDirs`、`createWorkbuddyDb`、`stepLine`，能在临时 `WORKBUDDY_HOME` 里造出与真实库兼容的 `sessions` / `session_usage` 和会话 jsonl。构造 `EtlConfig` 的位置分布在 `tests/acceptance.test.ts`、`tests/group-normalization.test.ts`、`tests/refresh.test.ts`、`tests/helpers/segment-fixture.ts`、`tests/helpers/stats-fixture.ts`，字段改名要一并覆盖。

## 技术方案与关键取舍

### AD-1 交互验收框架选 Playwright

| 候选 | 关键判断 | 结论 |
| --- | --- | --- |
| Playwright | 自带 test runner、自动等待与 web-first 断言、trace / 截图、webServer 一键起停；默认焦点模拟可替代手写 CDP；`page.evaluate` 读页面内状态；Microsoft 活跃维护，1.65 起支持 Node 22 / 24 / 26 | 选用 |
| Cypress | 调试体验好，但单 tab / 单 origin 架构受限、并行偏付费面板，2026 年新项目少选 | 不选 |
| WebdriverIO | 协议控制强、插件多，配置面与学习成本明显高于本项目需要 | 不选 |
| Vitest Browser Mode | Vitest 4 已稳定，但定位是组件测试，仍需 Playwright provider，不提供完整全应用 E2E 运行体验 | 不选 |

**理由**：Spec R10 的每一项能力都由框架原生提供，不需要再写一层驱动；与现有 Vitest 单测分层清晰（Vitest 管纯函数与服务层聚合，Playwright 管浏览器）。代价是首次需下载 Chromium 二进制，以及引入一个开发期依赖。版本策略：`@playwright/test` 固定在同一个小版本线（安装前核对官方 release notes 的最新补丁），浏览器二进制不入库。

### AD-2 服务形态为 build + start 单端口

`npm run build && npm start` 前后端同次构建，避开 `devops.md` 记录的「前后端版本错配导致趋势图空白」，也与用户日常使用形态一致。Playwright `webServer` 只负责启动 `npm start` 并在结束时回收，构建放在 npm script 前置，避免 webServer 杀 shell 时遗留 node 子进程。端口用独立的 `PORT`（不与日常 4620 冲突），`HOST` 仍为回环地址，`reuseExistingServer: false` 防止连到旧实例。

**取舍代价**：构建每次验收都跑一遍；换来的是单一进程、可靠清理与构建一致性，样本量很小，运行时间可接受。

### AD-3 临时数据库与命名统一

- `resolveEtlConfig` 的 `DATABASE_PATH` 已实现：未设置时返回 `resolve('.data/database.db')`，验收时设为 `<临时目录>/database.db`，与样本同目录。
- 命名重构已完成：模块、文件、函数、测试、字段与所有 `EtlConfig` 构造点同步更新，不改表结构、`schema_version`、刷新流程与 API；typecheck / test / build 已通过。
- 文档术语统一：`devops.md` 配置项表补 `DATABASE_PATH`，长期文档与未归档交付文档统一「数据库」与「WorkBuddy 数据库」，表上的 `CREATE INDEX` 仍叫「索引」；归档文档不动。
- **理由**：AC12 要求临时目录与数据库一起被清理，且不触碰真实 `~/.workbuddy` 与日常 `.data/database.db`（日常面板可能正在运行，共用 sqlite 文件会争锁；切换数据源后旧数据库里的绝对路径也会被判为「文件已不存在」而清理，样本与残留混杂）。命名统一解决的是「把数据库文件叫索引」的误导，不是功能需求。

### AD-4 断言按 Playwright 重写为可见行为

不再读 ECharts 实例、不给 `EChart.tsx` 加测试钩子——此处限制的是**验收用例的断言方式**；产品代码为聚焦功能监听图表实例的 hover 事件不受此限。用例断言用户可见的渲染结果：

| 验收内容 | 新框架的判定方式 |
| --- | --- |
| tooltip 内容、格式、0 值过滤、降序、日期行与「无数据」 | hover 后断言 ECharts 生成的 tooltip DOM 文本（`toContainText` / `toHaveText`） |
| 数值单位、刻度格式、转义、0 值隐藏 | 由 `format.ts` / `trend-chart-option.ts` 的既有 Vitest 单测锁定；e2e 断言指标卡、明细表、tooltip 的可见文本 |
| 系列颜色、跨筛选稳定 | 读图例色点、模型下拉色点、分组段色的 computed style，不读 `option.series[].itemStyle.color` |
| 价格比率折线、第二 Y 轴 | hover 后 tooltip 的 `×` 文本与图例；折线的 option 结构由纯函数单测覆盖 |
| 聚焦减淡 0.4 与恢复 | 常量与 option 的 blur 配置由纯函数单测锁定数值；e2e 断言分组段、tooltip 行、浮层行的 computed opacity 与移出恢复，canvas 区域截图作为人工复核材料，不进自动断言 |
| 网络与只读约束 | `page.on('request')` 断言无外部域名请求、无配色专用全量请求 |

- `page.evaluate` 只用于读 DOM、计算样式与几何，不用于调用图表内部 option / formatter；`page.request` 只做辅助核对。
- canvas 内柱段 hover 用 canvas 的 bounding box 按类目数均分推算坐标 + `page.mouse.move()`，以 tooltip DOM 出现作为命中确认，`expect` 自动重试处理时序；不依赖实例换算像素，也不写固定 `wait()`。
- **理由**：build 形态下 Vite 不再输出带 `echarts` 字样的独立资源，旧读法本就失效；为保住它去改产品代码是让产品迁就工具。改为可见行为断言后，dev / build 形态一致、失败信息直观、零产品代码改动，白盒逻辑由已有的 Vitest 单测承担，测试分层更清晰。

### AD-5 固定样本、固定期望与冻结业务时间

- 新增 `scripts/e2e-fixture.mjs`：复用 `tests/helpers/` 的三个构造器，在 `.data/e2e/home` 生成 `workbuddy.db` 与 `projects/**/*.jsonl`，每次运行清空重建；`.data/` 已在 `.gitignore` 中。
- 样本显式覆盖：多模型（含 DeepSeek 模型以触发价格比率折线）、多分组（含 WorkBuddy 自动生成的工作目录，用于「默认」分组断言）、多日期、0 值日、单模型日、极窄段（某模型数额远小于同组其它模型）、自动分组空范围、缓存命中可手算、100 天边界可构造；跨度控制在 100 天内。
- **期望值固定在样本里**：fixture 生成时同时产出模型集合、分组集合、按天合计、缓存命中率、价格比率等期望数据，用例直接断言这些值；不从 `/api` 现场反推。另加一条样本自检（模型数、日期范围、样本目录路径），确保用例确实跑在样本上。
- 业务日期固定为样本基准日；用例在 `page.goto` 前用 Playwright Clock API 的 `setFixedTime`（只固定 `Date.now`，不接管定时器，避免影响 ECharts 动画与 React 调度）冻结浏览器时间，使「今天 / 3 天 / 7 天 / 30 天」与日期轴稳定。

### AD-6 聚焦状态、强度与业务键

- 单一常量 `FOCUS_DIM_OPACITY = 0.4` 放在 `src/shared/constants.ts`，四处（趋势图系列、趋势图 tooltip 行、分组条色段、分组浮层行）共用，AC5 的「唯一值」由常量与纯函数单测保证。
- 聚焦状态放在 `TrendChart` 与 `BreakdownList` 组件内部各自的 `useState`，用模型**业务键**作值；`App.tsx` 不持有，避免跨视图联动。状态在 `option` / `rows` / `activeTab` 变化时由 effect 清空，覆盖 R5 的切 tab、改筛选、刷新与重载。
- 趋势图：`buildTrendChartOption` 增加 `focusedModel` 参数，柱系列通过 blur 状态配置把非聚焦系列不透明度设为 0.4（具体字段以 ECharts 6 实际行为为准，由单测断言生成的配置），保留 `focus: 'series'` 语义；tooltip formatter 按业务键给非聚焦模型行加行内 opacity，日期行与「无数据」不加。hover 事件由图表实例的 `mouseover` / `mouseout` 提供，只接受 `componentType === 'series'` 的柱段，`seriesId` 即业务键；图例、坐标轴、空白类目不触发。链路：`EChart.tsx` 注册可选事件回调 → 过滤 `componentType` → 以 `seriesId`（业务键）调用 `onFocusChange` → `TrendChart` 内部 `useState` 持有 → 回灌 option 与 tooltip 行样式；这是产品功能，不是测试钩子。
- 浮层：`BreakdownTooltip` 接收 `focusedModel`，逐行按业务键加 opacity；内容、降序、0 值过滤、格式、定位与 `pointer-events: none` 不变。

### AD-7 极窄段的最小命中区

`.breakdown-segment` 保持原有 `width` 与 `backgroundColor` 不变，在其内部加一个绝对定位的透明命中层，仅当视觉宽度低于阈值时生效，且命中层不越过该段与相邻段的边界（按段序与可用宽度收敛），保证同一指针位置只判定一个模型（R1 / R4）。段集合、段序、段宽之和、条长与条上空白区都不变。阈值为实现细节，在 Tasks 阶段按实测确定，不作为需求变量。

### AD-8 用例组织与运行器隔离

- `playwright.config.ts`：`testDir: 'tests/e2e'`、`testMatch: '**/*.spec.ts'`，避免把 Vitest 的 `*.test.ts` 当 e2e 用例；`workers: 1`、`fullyParallel: false`。理由：24 项覆盖共享同一份样本、同一个服务实例与同一份筛选状态，并行会引入竞态。
- 用例按验收主题用 `test.describe` 分组（tab 与 ARIA、筛选与时间区、拆分列表与明细、趋势图与 tooltip、hover 聚焦、网络与只读），每个用例通过 `beforeEach` 自准备前置状态（打开页面、冻结时间、等首屏数据），不依赖前一个用例留下的状态；定位器集中封装在页面对象里，避免选择器散落。
- `tsconfig.json` 的 include 补 `playwright.config.ts`，让独立类型检查覆盖配置与 `tests/e2e/`；`vitest.config.ts` 不改。
- 失败时保留 trace 与截图（`trace: 'retain-on-failure'`、`screenshot: 'only-on-failure'`），输出到 `.data/e2e-results/`；成功不留产物。`globalTeardown` 清理 `.data/e2e/`。
- `npm run acceptance` 一条命令串起「生成样本 → 构建 → playwright test」，`package.json` 只改 devDependencies 与 scripts，`dependencies` 不变（对应 Spec「不改产品运行时依赖」）。

### AD-9 与旧脚本的关系

旧脚本只提供**覆盖清单**：24 项验收覆盖逐项保留、标准不放宽，对照记录写进 `hover-model-focus-tasks.md` 的任务验证字段，不新增独立验证文档。用例的判定方式、期望值来源、交互手段一律按 AD-4 / AD-5 / AD-8 重新设计，不做「旧写法 → 新写法」的一比一翻译。对照的是覆盖项与判定标准，不是旧脚本的实现方式或数值结果（旧脚本跑真实数据，新用例跑固定样本，数值本就不同）。

### 顺序约束（影响正确性，必须按此顺序）

1. **前置改动已完成**：数据库命名重构、`DATABASE_PATH` 实现与全项目术语统一已落地并通过 `npm run typecheck`、`npm test`、`npm run build`；Tasks 从验收基础设施与 hover 聚焦功能开始，不重复这部分工作。
2. 验收运行时：生成样本（含固定期望值）→ `npm run build`（前后端同次构建）→ 启动服务（首次刷新读样本、按 `DATABASE_PATH` 建临时数据库）→ 执行用例 → 清理。顺序不可颠倒：服务启动前样本未就绪会刷出空库，构建晚于启动会出现前后端版本错配，`DATABASE_PATH` 未生效会污染日常实例。
3. 24 项覆盖清单**先固化**，再逐项重写用例；旧脚本在对照完成前不得删除。
4. 聚焦实现：常量与业务键判定 → 四处渲染与状态清除 → hover 事件与命中区 → e2e 断言。先定 0.4 与业务键，避免各处用展示名或不同强度导致 AC5 回归。
5. 长期文档在功能与验收通过后同步，不先写事实后改代码。

## 影响范围

**新增**：`playwright.config.ts`、`tests/e2e/`（用例、页面对象与样本期望数据）、`scripts/e2e-fixture.mjs`、`docs/delivery/hover-model-focus-plan.md`（本文件）。

**前置改动已完成**：`src/etl/config.ts`（`databasePath` + `DATABASE_PATH`）、`server/index.ts`、`src/etl/database.ts`、构造 `EtlConfig` 的测试 / helper、全项目文档术语与命名。

**修改（后续任务）**：`package.json`（devDependencies 加 `@playwright/test`、scripts 改 `acceptance`）、`tsconfig.json`（include 补配置文件）、`src/web/trend-chart-option.ts`（`focusedModel` 与 blur / tooltip 行样式）、`src/web/components/TrendChart.tsx`、`src/web/components/EChart.tsx`（hover 事件回调，非测试钩子）、`src/web/components/BreakdownList.tsx`、`src/web/components/BreakdownTooltip.tsx`、`src/web/styles.css`（命中层与行内减淡）、`src/shared/constants.ts`、`tests/trend-chart-option.test.ts` 等既有单测`、`docs/devops.md`（仅交互验收章节）、`docs/technical-architecture.md`（开发期测试依赖、测试分层与 hover 聚焦描述）；`docs/data-model.md`、`product-brief.md`、`integration.md` 的命名与术语已由前置改动完成，本交付仅核对。

**删除**：`scripts/panel-acceptance.mjs`（对照完成、新入口通过之后）。

**不改**：`tests/*.test.ts` 的服务层聚合断言与 `vitest.config.ts`、`server/query.ts` 与 `server/app.ts` 的聚合与端点、数据库表结构与 `schema_version`、`src/etl/refresh.ts` 的刷新流程、`src/web/model-colors.ts` 的色表、已完成交付文档与归档文档中记录当时文件名的路径字面、`docs/model-colors.md`。

## 数据或接口变化

- **无 API 契约变化**：五个端点路径、响应结构、筛选语义、统计口径与 `schema_version` 均不变；`buildTrendChartOption` 新增的是内部展示配置字段。
- **新增运行配置项** `DATABASE_PATH`（可选，默认值 `resolve('.data/database.db')` 不变），对应代码字段 `databasePath`；属 devops 配置，不是接口。`PORT` / `HOST` / `WORKBUDDY_HOME` 沿用既有语义。
- **样本数据是测试产物**：`.data/e2e/home`、样本期望数据与 `.data/e2e/database.db` 每次运行重建、结束清理、不入库、不写真实 `~/.workbuddy`。样本只构造本项目读取的列与字段，不模拟 WorkBuddy 的完整数据模型。

## 兼容与迁移方案

- 24 项覆盖按 AD-9 逐项对照；hover 聚焦 AC1–AC7 的新断言与既有覆盖写在同一套用例里，按 tab 与视图分组，不另起脚本。
- 命名重构与 `DATABASE_PATH` 已在前置改动完成并通过 typecheck / test / build；未设置 `DATABASE_PATH` 时行为与原来一致。
- 入口切换完成后 `npm run acceptance` 仍是一个命令；`npm test`、`npm run typecheck`、`npm run build` 的命令与覆盖范围不变，typecheck 是独立必需项，不能被 lint / build / 测试代替（仓库无 lint）。
- 已完成交付文档只统一术语词、保留当时的路径字面与实施记录；`v1.0.0/` 归档三份完全不动；长期文档的命名与术语已在前置改动同步，`devops.md` 交互验收章节与 `technical-architecture.md` 测试分层待 T010。
- Node 24 要求不变；Playwright 自身支持 22 / 24 / 26，但产品服务只接受 ≥24，验收命令必须运行在 Node 24 下，`devops.md` 写清 PATH 首位是 22 时的处理方式。

## 测试策略

- **分层**：Vitest 负责纯函数、格式化、图表 option 与服务层聚合（不改、不降级）；Playwright 负责浏览器可见行为验收；两者靠 `testDir` / `testMatch` / include 隔离。
- **纯函数单测**：`buildTrendChartOption` 增加 `focusedModel` 后的 tooltip 行 opacity、日期行与「无数据」分支、0 值过滤与降序、blur 强度 0.4 与常量唯一性、价格比率折线结构；`segmentWidths` / `visibleSegments` 的既有断言继续通过；新增按业务键计算行不透明度的纯函数单测。
- **交互验收**：`npm run acceptance` 一条命令跑 24 项既有覆盖 + AC1–AC7 新增断言；连续运行两次结果一致（AC11）；失败输出用例名、断言与 trace / 截图。
- **必需检查**：`npm run typecheck`（独立）、`npm test`、`npm run build`、`npm run acceptance`；全量检查集中在收尾任务，各任务记录相关验证。当前沙箱的 vitest runner 环境差异见 `docs/backlog/vitest-runner-context.md`，正式回归证据以开发者本地实跑为准，不得通过删测试或放宽标准规避。
- **文档同步检查**：`devops.md` 交互验收章节重写（不再要求手工起调试 Chrome、补 `npx playwright install chromium`；`DATABASE_PATH` 已在前置改动记录，本交付只核对）、`technical-architecture.md` 关键依赖表补开发期测试依赖与测试分层、面板层补 hover 聚焦描述，文档与代码无已知矛盾。

## 风险与回滚方式

| 风险 | 处理 |
| --- | --- |
| 命名重构漏改 `EtlConfig` 调用点 | 顺序约束 1；typecheck 覆盖 `tests`，改完先跑类型检查与单测 |
| 样本未就绪就启动服务 / 构建与服务错配 | 顺序约束 2，webServer 探到端口才放行用例 |
| `DATABASE_PATH` 未生效污染日常实例 | 用例自检断言临时数据库路径；`reuseExistingServer: false` |
| 无头焦点判定失效 | Playwright 默认焦点模拟，备选框架 CDP session；键盘 focus 断言必须实跑 |
| canvas 柱段黑盒 hover 命中不稳 | 用 tooltip DOM 出现作命中确认，坐标按类目均分推算，miss 时重试移动而非固定 sleep |
| 时间区断言随运行日漂移 | Clock API 只固定 `Date.now`，样本日期与基准日一致 |
| 样本期望值与实现脱节 | 期望值由同一份 fixture 生成器产出，样本自检先跑 |
| 并行用例竞态 | `workers: 1`、用例自准备前置状态 |
| 首次下载浏览器二进制失败 | 明确报错并指向 `devops.md` 安装步骤；不把环境未就绪记为通过 |
| 旧脚本删除后无法回溯 | 覆盖对照记录固化后再删，且可从 git 历史恢复 |
| 历史交付文档保留旧路径字面 | 按约定保留当时事实；长期文档用新名字并说明改名，读者以长期文档为准 |

**回滚**：验收基础设施改动集中在入口、配置、用例与运行配置项，回退时恢复 `package.json` 的 `acceptance`、移除 devDependency 与配置文件、从 git 历史取回 `scripts/panel-acceptance.mjs` 即可回到原流程；`DATABASE_PATH` 默认值不变，移除后日常运行无感。字段重命名按对应提交整体回退，不改表结构。展示层聚焦状态是内存态、不落库、不进查询串，回退对应前端提交即可，数据库按 `devops.md` 既有方式删库重建。样本与临时数据库都在 `.data/e2e/`，删除无数据安全风险；真实 `~/.workbuddy` 全程只读。

## 已确认的默认处理

- **命名与术语统一已确认完成**：见「命名与术语统一」一节与 Spec「已确认决策」，归档文档保留原样。
- **不引入 CI 或定时执行**（已确认）：项目没有 CI，交互验收只在本机通过 `npm run acceptance` 一条命令运行；未来若接入再另行评估。
- **不保留真实数据手动回归入口**（已确认）：自动用例只用固定样本，不提供真实数据的额外核对入口；失败时 trace 与截图保留在 `.data/e2e-results/`。
- **样本构造方式**：按 Spec「已确认决策」复用 `tests/helpers/`，细节见 AD-5，此处不重复。
