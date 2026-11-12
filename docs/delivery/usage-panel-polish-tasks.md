# T001 类型契约与刷新时间字段

状态：pending

目标与完成条件：`SummaryResponse` 追加 `lastRefreshAt: number | null`，`getSummary` 读 `meta.last_refresh_at` 并在缺失或非数字时返回 `null`；`tests/shared.test.ts` 的 `SummaryResponse` 字面量补齐字段，`tests/api.test.ts` 增加字段断言且原有 `body.token` / `body.credit` 的 `toEqual` 与 C14 断言不变；`npm run typecheck` 通过。对应 Spec R9、AC9 与 Plan「刷新完成时间」「实施顺序 1」。

修改范围：`src/shared/types.ts`、`server/query.ts`、`tests/shared.test.ts`、`tests/api.test.ts`。

# T002 展示纯函数与单测

状态：pending

目标与完成条件：`format.ts` 增加 `formatTokens`（K / M / B，1 位小数）与 `formatRefreshTime`（本地 `HH:mm`），`formatInteger` / `formatCredit` / `formatPercent` 行为不变；新增 `src/web/display.ts` 承载 `visibleModelKeys`、`visibleBreakdownRows`、`cacheHitRate`；新增 `tests/display.test.ts` 覆盖单位临界值、两个 tab 的 0 值判定、截取与全量计数分离、分母为 0 返回 `null`。对应 Spec R3 / R5 / R6 / R7 与 Plan「纯函数下沉」。

修改范围：`src/web/format.ts`、`src/web/display.ts`、`tests/display.test.ts`。

# T003 模型展示名冲突与结构版本

状态：pending

目标与完成条件：`computeModelDisplayNames` 在规范化后按展示名分组、组内按 `modelKey` 字典序给非首项追加 `(modelKey)` 后缀，结果与候选顺序无关；`SCHEMA_VERSION` 由 1 递增到 2；`tests/dimensions.test.ts` 补冲突用例，`tests/refresh.test.ts` 补「增量刷新只解析部分文件时展示名不回退」用例；删除 `.data/index.db` 全量重建后，`hy4` 与 `hy4-free` 展示名可区分且连续两次重建结果一致。对应 Spec R8、AC8 与 Plan「模型展示名冲突」「实施顺序 2 / 3」。

必要依赖：无；但须在 T009 之前完成（Plan 实施顺序 3）。

修改范围：`src/etl/dimensions.ts`、`src/etl/index-db.ts`、`tests/dimensions.test.ts`、`tests/refresh.test.ts`。

# T004 筛选状态收敛

状态：pending

目标与完成条件：删除 `drill()`、`detailSession`、`chips`、`labelOf()`、`scrollIntoView` 及 `.filter-chips` / `.chip-*` / `.detail-banner` 样式；列表点击与下拉框 `onChange` 统一走 `patchFilters`，不再存在第二套状态；`FilterBar` 移除 `ActiveChip` / `chips` / `onClear`，`isDefault` 改为判断三个维度筛选均为空；保留 `renderOptions` 的当前值兜底。对应 Spec R1、行为 1、AC1 与 Plan「状态与组件结构」。

必要依赖：T001。

修改范围：`src/web/App.tsx`、`src/web/components/FilterBar.tsx`、`src/web/styles.css`。

# T005 Tab 结构与状态保持

状态：pending

目标与完成条件：新增 `ModuleTabs.tsx`（`role="tablist"` / `aria-selected` / `aria-controls`），`activeTab` 默认 `'token'`，两个 `ModuleSection` 条件渲染；所有 `useQuery` 仍在顶层无条件调用；切换 tab 保留筛选、时间预设、两张表折叠状态与排序状态；首次激活两种 tab 时图表尺寸正常。对应 Spec R2、AC2 与 Plan「状态与组件结构」「实施顺序 4」。

必要依赖：T004。

修改范围：`src/web/App.tsx`、`src/web/components/ModuleTabs.tsx`、`src/web/styles.css`。

# T006 拆分列表固定行数

状态：pending

目标与完成条件：用 `visibleBreakdownRows(rows, 8)` 截取，容器高度由 `--rows` 与 `--breakdown-row-height` 的 CSS `calc` 计算，JS 不硬编码像素；移除 `.breakdown-list` 的 `max-height` / `overflow: auto`，`.breakdown-row` 固定高度；「N 项」与 `tokenShare` / `creditShare` 仍按全量计算，被截断项仍可从筛选下拉选中。对应 Spec R3、AC3 与 Plan「拆分列表固定行数」。

必要依赖：T002、T005。

修改范围：`src/web/components/BreakdownList.tsx`、`src/web/styles.css`。

# T007 明细折叠与懒加载

状态：pending

目标与完成条件：`useQuery` 支持 `path: string | null`，`null` 时状态为 `{ data: null, loading: false, error: null }` 且不发请求；`RequestTable` 增加 `open` / `onToggle` 与 `aria-expanded` / `aria-controls`，标题栏整行可展开收起；两表折叠状态独立、默认折叠、默认 `startedAt desc`（**API 默认排序不改**，由 `filterParams` 显式传参）；展开后表头排序可用，440px 表格内部滚动保留。对应 Spec R4、AC4 与 Plan「明细折叠与懒加载」。

必要依赖：T001、T005。

修改范围：`src/web/useQuery.ts`、`src/web/components/RequestTable.tsx`、`src/web/App.tsx`。

# T008 数值单位与命中率

状态：pending

目标与完成条件：四个 token 指标卡、拆分列表 token 分支、明细表四个 token 列、趋势图 tooltip 与 y 轴刻度改用 `formatTokens`，趋势图不再出现「万 / 亿」；积分列继续用 `formatCredit`，积分 y 轴去掉 `1.0k`、改用 `formatInteger(Math.round(value))`；请求数 / 会话数 / 条数保持 `formatInteger`；`MetricItem` 增加可选 `suffix`，「缓存命中」卡显示 `cacheHitRate` 结果，分母为 0 时显示 `—`，不新增卡片与趋势序列。对应 Spec R5 / R6、AC5 / AC6 与 Plan「数值与命中率」。

必要依赖：T002、T006、T007。

修改范围：`src/web/App.tsx`、`src/web/components/BreakdownList.tsx`、`RequestTable.tsx`、`MetricCards.tsx`、`TrendChart.tsx`。

# T009 0 值隐藏

状态：pending

目标与完成条件：按 `activeTab` 用 `visibleModelKeys` 过滤按模型拆分行、传给 `TrendChart` 的 `timeseries.rows`（`days` 原样保留）与模型下拉选项；按分组 / 按对话列表和请求级明细不过滤；服务层聚合 SQL 不变，维度拆分之和仍等于总览；下拉保留已选模型兜底；不显示任何隐藏提示。对应 Spec R7、AC7 / AC10 与 Plan「0 值隐藏」「实施顺序 3」。

必要依赖：T002、T003、T005。

修改范围：`src/web/App.tsx`。

# T010 刷新完成时间显示

状态：pending

目标与完成条件：`header-actions` 的「刷新数据」按钮前用 `formatRefreshTime` 显示 `lastRefreshAt`，`null` 时显示「尚未刷新」；刷新成功后随现有 `version` 依赖重新取 `/api/summary` 自动更新；不新增端点、不新增状态。对应 Spec R9、AC9 与 Plan「刷新完成时间」。

必要依赖：T001、T002、T005。

修改范围：`src/web/App.tsx`。

# T011 文档同步与收尾验收

状态：pending

目标与完成条件：按实现结果更新 `product-brief.md`（范围段与成功标准措辞）、`technical-architecture.md`（面板层描述、`/api/summary` 接口表、Hono 依赖行措辞）、`data-model.md`（C12 展示名冲突规则、结构版本）；核对两份 Spec、本 Plan、Tasks 与长期文档无矛盾，删除不再适用的说明；按 Spec AC1–AC11 逐条验收，其中 DOM 与 ECharts 交互按 Plan「前端交互验收」用 `npm run dev` 手工核对并记录；全量执行 `npm run typecheck`、`npm test`、`npm run build`；逐项完成 AGENTS.md 第 5 节收尾检查，并一次性回填 T001–T010 的「提交」字段（本任务不填该字段）。对应 Plan「实施顺序 5」「测试策略」「影响范围」。

必要依赖：T001–T010。

修改范围：`docs/`、`docs/delivery/usage-panel-polish-tasks.md`。
