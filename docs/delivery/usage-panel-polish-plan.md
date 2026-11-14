# 面板可读性优化 Plan

## 现状分析

- 本交付的 Spec 已确认（`usage-panel-polish-spec.md`），业务规则 R1–R10 与验收标准 AC1–AC11 不在此重复；Spec 与 Plan 均已确认并入库。
- 代码现状：单一 `App.tsx` 持有 `filters`、`preset`、`custom`、`detailSession`、`version`、两套排序状态，顶层无条件调用 10 个 `useQuery`（总览、时序、三个拆分、三个下拉、两张明细），两个 `ModuleSection` 上下平铺并各自渲染一套卡片 / 图表 / 拆分 / 明细。
- 「下钻」相关代码集中在 `App.tsx` 的 `drill()`、`detailSession`、`labelOf()`、`chips` 与 `scrollIntoView`，以及 `FilterBar.tsx` 的 `ActiveChip` / `chips` / `onClear` 和 `styles.css` 的 `.filter-chips` / `.chip-*` / `.detail-banner`。这部分是纯删除，不涉及后端。
- `EChart.tsx` 已内置 `ResizeObserver`，只渲染激活 tab 时无需改造图表组件本身。
- `useQuery(path, deps)` 只接受字符串路径，折叠时不请求需要扩展为可传 `null`；`getRequests` 的默认排序是 `totalTokens desc`，现有 `tests/api.test.ts` 对该默认值有断言。
- `format.ts` 的 `formatInteger` 同时服务 token 数值与请求数 / 会话数 / 条数；`TrendChart` 的 `axisValue` 另有「万 / 亿」与积分 `k` 的刻度格式。
- 模型展示名由 `computeModelDisplayNames(candidates)` 纯函数算出，`refresh.ts` 用「本次待解析文件」的候选集合调用它；`DimensionWriter.upsertModel` 只在 `display_name = model` 时用新候选覆盖，已规范化的名字不回退。实测 `hy4` 与 `hy4-free` 候选都是 `Hy4`。
- `SCHEMA_VERSION` 当前为 1；`meta.last_refresh_at` 已由刷新流程写入，但 `SummaryResponse` 未暴露，`RefreshResult` 才带 `lastRefreshAt`。测试夹具通过 `openIndex()` 建表，`meta` 表存在且刷新后 `last_refresh_at` 非空。
- `tests/shared.test.ts` 手工构造 `SummaryResponse` 字面量；`tests/api.test.ts` 用 `toEqual` 断言 `body.token` / `body.credit`，并检查所有 API 返回值不含 `id` 键。
- 前端目前没有 DOM 测试框架（无 jsdom / testing-library / playwright），依赖里也没有相关包。

## 技术方案

### 状态与组件结构

`App.tsx` 保留唯一的 `filters` 状态，新增 `activeTab: 'token' | 'credit'`（默认 `'token'`）、`tokenDetailOpen` / `creditDetailOpen`（默认 `false`），把 `tokenSort` / `creditSort` 默认值改为 `{ field: 'startedAt', order: 'desc' }`。删除 `detailSession`、`chips`、`labelOf`、`drill`、`scrollIntoView`；列表点击统一走 `patchFilters({ [dimension]: key })`，与下拉框 `onChange` 同一路径。

新增 `src/web/components/ModuleTabs.tsx` 渲染两个 tab（`role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`），放在 `FilterBar` 与模块内容之间。`FilterBar` 删除 `chips`、`ActiveChip`、`onClear`、`DIMENSION_LABELS`；`isDefault` 改为判断 `preset === 'today'` 且三个维度筛选都为空。`renderOptions` 中「当前值不在选项里时补一个 option」的兜底**保留**，用于 0 值隐藏后不丢失已选中的筛选值。

两个 `tabpanel` 容器常驻 DOM，未激活的用 `hidden` 隐藏并保持为空壳，使 `aria-controls` 始终指向存在的面板；两个 `ModuleSection` 仍条件渲染，只挂载激活 tab 的模块内容。**所有 `useQuery` 仍在组件顶层无条件调用**，React Hooks 不能条件执行；tab 条件渲染本身不增加数据请求，切换 tab 不重置任何状态，`activeTab` 变化只触发一次重新渲染，未挂载的模块重新出现时 `EChart` 由 `ResizeObserver` 按容器尺寸渲染。配色另需一次不带筛选的模型拆分查询（见「配色稳定」）。

### 纯函数下沉

把可复算的展示逻辑抽成 `src/web/` 下的纯函数并单测覆盖，组件保持薄：

- `format.ts` 新增 `formatTokens(value)`（K / M / B，1 位小数）与 `formatRefreshTime(ts)`（本地 `HH:mm`）；`formatInteger` 行为不变，仍用于计数与趋势图积分刻度，`formatCredit` / `formatPercent` 不变。
- `visibleModelKeys(rows, activeTab)`：Token tab 取 `totalTokens !== 0`，积分 tab 取 `credit !== 0`，返回业务键集合；只隐藏恰好为 0 的项，负值可见。
- `cacheHitRate(inputTokens, cacheReadTokens)`：分母为 0 时返回 `null`。
- `visibleBreakdownRows(rows, limit)`：截取前 N 行，`limit` 固定 8；排序仍由 `BreakdownList` 按当前指标完成后传入，函数不重复排序。

其中 `formatTokens` / `formatRefreshTime` 放 `src/web/format.ts`，其余三个放新增的 `src/web/display.ts`；组件只调用、不内联判断。面板仍只渲染 API 返回值，不自行求和换算（AD-4）：占比、合计全部沿用服务层结果。

### 明细折叠与懒加载

`useQuery` 签名改为 `useQuery<T>(path: string | null, deps)`；`path === null` 时把状态置为 `{ data: null, loading: false, error: null }` 并跳过 fetch。`path` 从 `null` 变为 URL 时 effect 自动请求。App 里按各自的 `tokenDetailOpen` / `creditDetailOpen` 决定传 URL 还是 `null`，不按 tab 激活状态决定，避免切换 tab 时重复请求。

`RequestTable` 增加 `open` / `onToggle` props：标题栏整行作为 `<button aria-expanded aria-controls>`，折叠时只渲染标题栏，`panel-meta` 显示「点击展开」，展开后显示行数与表格。表头排序沿用 `onSort` + API 排序；**API 默认排序不改**，前端通过 `filterParams(filters, { sort, order })` 显式传 `sort=startedAt&order=desc`，因此 `tests/api.test.ts` 的默认值断言保持有效。展开后 `.table-wrap` 的 440px 内部滚动保留。

### 拆分列表固定行数

`BreakdownList` 用 `visibleBreakdownRows(rows, 8)` 截取，容器通过内联 `style={{ '--rows': visible.length }}` 配合 CSS `height: calc(var(--rows) * var(--breakdown-row-height))` 计算高度；行高只在 CSS 变量 `--breakdown-row-height` 定义一处，JS 不重复硬编码像素值。移除 `.breakdown-list` 的 `max-height: 360px; overflow: auto`，给 `.breakdown-row` 设固定 `height` 与 `box-sizing: border-box`。「N 项」仍用传入的全量 `rows.length`，占比仍用服务层的 `tokenShare` / `creditShare`。

### 数值与命中率

替换 `formatInteger` 的调用点：Token 四张指标卡、拆分列表 token 分支、明细表四个 token 列、趋势图 tooltip 与 y 轴刻度。积分列继续用 `formatCredit`；趋势图积分 y 轴去掉 `1.0k`，改用 `formatInteger(Math.round(value))`；趋势图 token y 轴的「万 / 亿」换成 `formatTokens`。计数类（请求数、会话数、有 / 无积分记录数、条数）保持 `formatInteger`。已有的 `title={row.key}` 是路径 / 标识而非数值精确值，保留不动。

`MetricCards` 的 `MetricItem` 增加可选 `suffix?: string`，渲染为 `.metric-value` 后的小字号内联元素。「缓存命中」卡传入 `suffix: formatPercent(rate)`（率由 `cacheHitRate` 算出，`null` 时 `—`），实现 Spec 要求的「数值旁同时显示比率」，不新增卡片、不动布局。积分模块不加该后缀。

### 0 值隐藏

App 按 `activeTab` 计算 `visibleModelKeys`，统一作用于三处：按模型拆分列表的 rows、传给 `TrendChart` 的 `timeseries.rows`、模型筛选下拉的 `modelOptions`。趋势图组件本身不改，由 App 构造一份过滤后的 `TimeseriesResponse`（`days` 原样保留）。按分组 / 按对话列表与请求明细不过滤。服务层聚合 SQL 不变，因此 R13 与 AC10 在 API 层天然成立；被隐藏行的指标为 0，前端展示的拆分之和仍等于总览。

下拉框保留 `renderOptions` 的兜底：若 `filters.model` 指向一个在当前 tab 被隐藏的模型，仍显示该选项，避免筛选值与下拉状态矛盾。

### 配色稳定

`modelColorIndex(rows)` 按展示名（同名按业务键）排序分配固定色位，结果只取决于传入的模型序列。若传当前筛选下的集合，筛选导致模型成员变化时序列会重排、同一模型换色；因此 App 额外请求一次**不带任何筛选**的 `GET /api/breakdown?dim=model`，只用于计算色位，把同一份索引传给两个 `TrendChart`。该查询路径固定，只在 `version` 变化时重取，不影响任何聚合与筛选口径；0 值隐藏的判定集合仍是带时间 / 分组 / 对话筛选的 `modelOptions`，两者互不混用。全量集合返回前 `colorIndex` 为空，图表沿用可见集合顺序，返回后色位固定。

### 模型展示名冲突

在 `computeModelDisplayNames` 末尾增加冲突处理：按展示名分组，组内按 `modelKey` 字典序排序，首项保留规范化名，其余改为 `规范化名 (modelKey)`。当前结果即 `Hy4` 与 `Hy4 (hy4-free)`。规则只依赖本次候选集合、与遍历顺序无关。

`SCHEMA_VERSION` 由 1 递增到 2，启动时删库全量重建，使首次结果基于完整候选集合。后续增量刷新只解析部分文件时，`upsertModel` 的「只在 `display_name = model` 时覆盖」保证已规范化的名字不回退，因此不需要每次刷新重算全库冲突。补一条回归测试覆盖该场景。

**与后续交付的顺序约束**：`group-normalization` 交付也要递增 `schema_version`，必须从 2 递增到 3，不能写死 2；两份交付都修改 `server/query.ts`（本交付改 `getSummary`，分组交付改 `getBreakdown` / `buildWhere` / `getRequests`），`FilterBar.tsx` 只由本交付修改，分组交付通过服务层聚合间接影响下拉选项；按本交付先、分组归一化后的顺序实施。

### 刷新完成时间

`SummaryResponse` 增加 `lastRefreshAt: number | null`；`getSummary` 在现有聚合查询之外增加一次 `SELECT last_refresh_at FROM meta WHERE id = 1`，缺失或非数字返回 `null`。不新增端点、不改筛选逻辑。面板在 `header-actions` 的刷新按钮前显示 `formatRefreshTime`，为 `null` 显示「尚未刷新」；刷新成功后现有 `setVersion` 会让所有 `useQuery` 重取，显示自动更新，无需额外状态。

### 样式与可访问性

新增 `.module-tabs` / `.module-tab` / `.metric-suffix` / `.breakdown-row` 固定高度相关样式，删除 `.filter-chips`、`.chip-*`、`.detail-banner` 及其 media query 段。沿用现有浅色主题 CSS 变量，不引入新配色、不加依赖。tab 与折叠控件补齐 ARIA 属性。

### 实施顺序（正确性约束）

1. 先改 `src/shared/types.ts` 的 `SummaryResponse`，再改 `server/query.ts`，最后改前端，否则类型检查不通过。
2. `SCHEMA_VERSION` 递增与 `computeModelDisplayNames` 改动同批提交；改完后删除 `.data/index.db` 全量重建再验收（沿用 v1 Plan 的顺序约束）。
3. 先完成模型展示名（解析层 / 维表），再做前端 0 值隐藏，避免用旧名字验收 AC7 / AC8。
4. 前端所有 `useQuery` 保持顶层无条件调用；条件渲染只作用于 JSX，不作用于 hooks。
5. 长期文档在功能验收通过后同步，避免先写事实后改代码。

## 关键取舍

| 选择 | 理由 | 代价 |
| --- | --- | --- |
| 只挂载激活 tab 的模块内容，tabpanel 容器常驻并 `hidden` | ECharts 零尺寸容器问题最干净的解法，`aria-controls` 不再悬空；`ResizeObserver` 已具备；状态天然保留 | 未激活 tab 的数据仍会请求，但不渲染；页面多两个空壳容器，成本可忽略 |
| `useQuery` 支持 `path: null` 而非引入查询库 | 不增删依赖、不改 API 契约、改动最小 | 折叠 / 展开切换会重新请求一次（数据量千行级，可接受） |
| API 默认排序不改，前端显式传 `startedAt desc` | 保持 API 契约与现有断言稳定，避免破坏其它调用方 | 面板首次展开时多带两个查询参数 |
| 展示逻辑抽成纯函数 | 前端无 DOM 测试框架，纯逻辑可单测，组件保持薄 | 多一个 `display.ts` 文件 |
| 行高用 CSS 变量、JS 只传行数 | 避免 JS 常量与 CSS 像素值两处不一致 | 依赖 CSS 自定义属性（现代浏览器均支持） |
| 0 值隐藏放在前端展示层 | 不改聚合 SQL，R13 / AC10 在服务层天然成立，风险最低 | 两个 tab 的下拉选项会不同（Spec 已确认） |
| 命中率用 `MetricItem.suffix` 而非新卡片 | 不动指标卡布局，改动局限于一个可选渲染分支 | 大数值旁多一段小字 |
| 冲突处理依赖 `schema_version` 全量重建 | 现有 `upsertModel` 不覆盖已规范化名字，靠重建一次性得到正确结果最稳 | 升级后首次启动触发一次全量重建（实测几十秒） |
| 不引入 DOM 测试框架 | 项目范围小、避免依赖增删；纯逻辑单测 + CDP 交互断言已覆盖风险 | 交互类 AC 需先启动带调试端口的 Chrome，运行方式见 `devops.md` |

## 影响范围

**新增**：`src/web/components/ModuleTabs.tsx`、`src/web/display.ts`（展示纯函数）、`tests/display.test.ts`（格式化与展示纯函数单测）、`scripts/panel-acceptance.mjs`（CDP 交互验收，T018 追加）。

**修改**：`src/web/App.tsx`、`src/web/components/FilterBar.tsx`、`BreakdownList.tsx`、`RequestTable.tsx`、`MetricCards.tsx`、`ModuleSection.tsx`、`TrendChart.tsx`、`src/web/format.ts`、`src/web/useQuery.ts`、`src/web/styles.css`、`src/shared/types.ts`、`server/query.ts`、`src/etl/dimensions.ts`、`src/etl/index-db.ts`（`SCHEMA_VERSION`）、`tests/shared.test.ts`、`tests/api.test.ts`、`tests/dimensions.test.ts`、`tests/refresh.test.ts`、`vite.config.ts`（仅 dev 代理前缀，见下）、`package.json`（T018 增加 `acceptance` 脚本入口）。

**文档**：`product-brief.md`（范围段、成功标准措辞）、`technical-architecture.md`（面板层描述、`/api/summary` 接口表、Hono 依赖行措辞）、`data-model.md`（C12 增加冲突处理、结构版本）、`devops.md`（dev 入口、代理前缀、交互验收步骤）。`integration.md` 本交付不涉及，不改。

**不改**：`~/.workbuddy` 下任何文件、`requests` 与 `groups` 表结构、五个 API 端点的路径与参数、`getRequests` 默认排序、刷新流程与积分挂接口径、依赖清单、构建产物配置。唯一例外是 `vite.config.ts` 的 dev 代理前缀：原 `/api` 会把前端模块 `api.ts` 也转发到 API 服务，导致 `npm run dev` 白屏，实施时收窄为 `^/api/`（提交 `e73fa1c`），不影响生产构建。

## 数据与接口变化

- `GET /api/summary` 响应追加 `lastRefreshAt: number | null`（顶层字段）。属向后兼容的字段追加，`body.token` / `body.credit` 结构不变，`tests/api.test.ts` 的 `toEqual` 断言不受影响；新增字段不含 `id`，C14 断言仍成立。
- `SCHEMA_VERSION` 1 → 2，启动时版本不匹配按现有机制删库重建；本交付**不加表、不加列**，只改变模型维表展示名的生成规则。
- 无新端点、无参数变化、无外部数据源变化、无网络调用。

## 兼容与迁移方案

- **数据库**：不写迁移脚本，`schema_version` 不匹配直接删库重建；实施与验收时需手动删除 `.data/index.db` 后再全量解析一次。切换 `WORKBUDDY_HOME` 同样先删库。
- **API 兼容**：追加字段，前端按可选值处理（`null` 显示「尚未刷新」），旧客户端忽略即可。
- **回归**：`getSummary` 多读一行 `meta`，测试夹具由 `openIndex()` 建表，表一定存在；`last_refresh_at` 为 NULL 时返回 `null`，不抛错。
- **Node / 依赖**：不改 `engines`、不增删 npm 包，`node:sqlite` 仍是唯一实验性依赖。
- **顺序兼容**：后续 `group-normalization` 交付从版本 2 递增到 3，两份交付的实施顺序不得调换。
- **回滚**：`git revert` 本交付的提交后，删除 `.data/index.db` 重建（旧代码的 `SCHEMA_VERSION` 为 1，会自动触发），无需 `npm install`、无需清理外部状态。

## 测试策略

- **类型检查是独立必需项**：`npm run typecheck`，不得被 lint / 构建 / 测试代替。
- **Vitest**（`npm test`）：
  - 新增格式化单测：0、999、1 000、10⁶、10⁹、临界值与小数位；断言 `formatInteger` / `formatCredit` 行为不变；`formatRefreshTime` 的本地时间格式。
  - 新增展示纯逻辑单测：`visibleModelKeys` 在两个 tab 下的过滤结果（含 0 值且另一指标非 0 的用例）、`visibleBreakdownRows` 截取与全量计数分离、`cacheHitRate` 分母为 0 返回 `null`。
  - `tests/dimensions.test.ts`：展示名冲突按字典序加后缀、结果与候选顺序无关、非冲突组不变。
  - `tests/refresh.test.ts`：增量刷新只解析部分文件时，已加后缀的展示名不回退。
  - `tests/api.test.ts`：`lastRefreshAt` 为数字且与 `meta.last_refresh_at` 一致；`body.token` / `body.credit` 的 `toEqual` 保持不变；C14 断言继续通过。
  - `tests/shared.test.ts`：`SummaryResponse` 字面量补齐 `lastRefreshAt`。
  - `tests/acceptance.test.ts`：v1 AC1–AC10 继续通过，重点确认 0 值隐藏不改 API 返回值、维度拆分之和仍等于总览（AC10）。
- **构建**：`npm run build`（含 `tsc -p tsconfig.build.json` 与 `vite build`）。
- **前端交互验收**：项目没有 DOM 测试框架，本交付不引入。AC1–AC9 中涉及 DOM 与 ECharts 的部分，由 `scripts/panel-acceptance.mjs` 经 CDP 驱动本机 Chrome 逐项断言（`npm run acceptance`，启动步骤见 `devops.md`），结果打印 PASS/FAIL 并以退出码反映；首轮逐条核对记录留在 Tasks 的验证字段，后续改动以脚本复跑为准。可复算逻辑全部由上面的纯函数单测覆盖。
- **只读验证**：刷新前后 `workbuddy.db` 只读边界不变，无需重复比对 mtime（v1 Plan 已说明该方式不可归因）。

## 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
| --- | --- | --- |
| 条件渲染让 `useQuery` 被条件调用 | React Hooks 报错、状态错乱 | 顺序约束第 4 条；所有 hooks 固定顶层，`npm run typecheck` 与构建兜底 |
| ECharts 在隐藏 / 新挂载容器尺寸为 0 | 图表空白或宽度异常 | 只挂载激活 tab 的模块内容，tabpanel 空壳常驻；`EChart` 已有 `ResizeObserver`；验收脚本核对两个 tab 的图表与 canvas 数 |
| 增量刷新把 `Hy4 (hy4-free)` 回退成 `Hy4` | 重名问题复现 | 依赖 `upsertModel` 的幂等保护 + 新增回归测试；必要时删库重建 |
| `schema_version` 与后续分组归一化交付冲突 | 旧数据库不触发重建，展示名 / 分组结果错误 | Plan 明确 1→2→3 与实施顺序；两份交付分别验收重建 |
| 0 值隐藏后已选模型不在下拉项里 | 筛选值看似丢失 | 保留 `renderOptions` 的当前值兜底；判定集合改用不含模型筛选的结果；验收脚本核对选中后仍可切换 |
| 折叠 / 展开反复请求导致 loading 闪烁 | 体验抖动 | `path: null` 时强制 `loading: false`；折叠态不渲染表格与骨架 |
| K / M / B 丢失精度 | 无法读到精确 token 数 | Spec 已确认不需要精确值；API 仍返回原始数值，随时可恢复 |
| `lastRefreshAt` 读取 `meta` 时表缺失 | `/api/summary` 500 | 单行查询用 `number()` 兜底，缺失返回 `null`；夹具已确认 `meta` 存在 |
| 交互验收依赖外部浏览器 | 未启动调试 Chrome 时脚本无法运行 | 验收脚本入库、逐项 PASS/FAIL 与退出码；纯函数单测覆盖可复算逻辑；不引入新依赖 |
| 文档与实现不同步 | 长期事实失真 | 功能验收通过后统一更新三份长期文档，收尾检查逐项核对 |

**回滚方式**：`git revert` 本交付提交 → 删除 `.data/index.db` → 重启触发全量重建 → `npm run typecheck && npm test && npm run build` 验证。无外部状态需要清理。
