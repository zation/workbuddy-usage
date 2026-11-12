# T001 类型契约与刷新时间字段

状态：done

目标与完成条件：`SummaryResponse` 追加 `lastRefreshAt: number | null`，`getSummary` 读 `meta.last_refresh_at` 并在缺失或非数字时返回 `null`；`tests/shared.test.ts` 的 `SummaryResponse` 字面量补齐字段，`tests/api.test.ts` 增加字段断言且原有 `body.token` / `body.credit` 的 `toEqual` 与 C14 断言不变；`npm run typecheck` 通过。对应 Spec R9、AC9 与 Plan「刷新完成时间」「实施顺序 1」。

修改范围：`src/shared/types.ts`、`server/query.ts`、`tests/shared.test.ts`、`tests/api.test.ts`。

实施结果：`SummaryResponse` 增加 `lastRefreshAt`；`getSummary` 在聚合查询之外增加一次 `SELECT last_refresh_at FROM meta WHERE id = 1`，缺失或非数字返回 `null`；补「从未刷新返回 null 且与筛选无关」用例，原 `toEqual` 与 C14 断言未改动。

验证：`npm run typecheck` 通过；`npx vitest run tests/api.test.ts tests/shared.test.ts` 18 项通过。

提交：a54a20d

# T002 展示纯函数与单测

状态：done

目标与完成条件：`format.ts` 增加 `formatTokens`（K / M / B，1 位小数）与 `formatRefreshTime`（本地 `HH:mm`），`formatInteger` / `formatCredit` / `formatPercent` 行为不变；新增 `src/web/display.ts` 承载 `visibleModelKeys`、`visibleBreakdownRows`、`cacheHitRate`；新增 `tests/display.test.ts` 覆盖单位临界值、两个 tab 的 0 值判定、截取与全量计数分离、分母为 0 返回 `null`。对应 Spec R3 / R5 / R6 / R7 与 Plan「纯函数下沉」。

修改范围：`src/web/format.ts`、`src/web/display.ts`、`tests/display.test.ts`。

实施结果：`formatTokens` 按 10³ / 10⁶ / 10⁹ 切 K / M / B，`999_999` 落在 <10⁶ 区间输出 `1000.0K`，为 Spec 阈值规则的直接结果，已在单测中固化；`formatRefreshTime` 输出本地 `HH:mm`；`display.ts` 提供 `visibleModelKeys` / `visibleBreakdownRows` / `cacheHitRate`。`visibleBreakdownRows(rows, limit)` 只做截取，排序仍由 `BreakdownList` 按当前指标完成（服务端按合计 token 降序返回，积分模块在前端按 credit 重排，Spec R3 已按此实情修订），故函数签名不带 metric。

验证：`npm run typecheck` 通过；`npx vitest run tests/display.test.ts` 12 项通过（含 0 / 999 / 1 000 / 999 999 / 10⁶ / 10⁹ 临界值、两 tab 判定、截取与全量计数分离、分母为 0）。

提交：caccba0

# T003 模型展示名冲突与结构版本

状态：done

目标与完成条件：`computeModelDisplayNames` 在规范化后按展示名分组、组内按 `modelKey` 字典序给非首项追加 `(modelKey)` 后缀，结果与候选顺序无关；`SCHEMA_VERSION` 由 1 递增到 2；`tests/dimensions.test.ts` 补冲突用例，`tests/refresh.test.ts` 补「增量刷新只解析部分文件时展示名不回退」用例；删除 `.data/index.db` 全量重建后，`hy4` 与 `hy4-free` 展示名可区分且连续两次重建结果一致。对应 Spec R8、AC8 与 Plan「模型展示名冲突」「实施顺序 2 / 3」。

必要依赖：无；但须在 T009 之前完成（Plan 实施顺序 3）。

修改范围：`src/etl/dimensions.ts`、`src/etl/index-db.ts`、`tests/dimensions.test.ts`、`tests/refresh.test.ts`。

实施结果：规范化后按展示名分组，组内按 `model` 标识字典序保留首项，其余追加 `(标识)`；`SCHEMA_VERSION` 由 1 增至 2。真实数据实测：删除 `.data/index.db` 后连续两次全量重建（272 个文件 / 923 条请求，约 3.5 秒），`hy4` → `Hy4`、`hy4-free` → `Hy4 (hy4-free)`，两次导出的 11 个模型展示名逐字节一致。

验证：`npx vitest run` 全量 86 项通过（含新增冲突用例、增量刷新不回退用例与 index-db 版本重建用例）；重建脚本的输出比对结果一致。

提交：66e4821

# T004 筛选状态收敛

状态：done

目标与完成条件：删除 `drill()`、`detailSession`、`chips`、`labelOf()`、`scrollIntoView` 及 `.filter-chips` / `.chip-*` / `.detail-banner` 样式；列表点击与下拉框 `onChange` 统一走 `patchFilters`，不再存在第二套状态；`FilterBar` 移除 `ActiveChip` / `chips` / `onClear`，`isDefault` 改为判断三个维度筛选均为空；保留 `renderOptions` 的当前值兜底。对应 Spec R1、行为 1、AC1 与 Plan「状态与组件结构」。

必要依赖：T001。

修改范围：`src/web/App.tsx`、`src/web/components/FilterBar.tsx`、`src/web/styles.css`。

实施结果：删除上述状态、函数与样式段（含媒体查询里的 `.detail-banner`）；六个列表入口统一为 `patchFilters({ group|session|model: key })`；`isDefault` 复用既有的 `hasActiveFilters`；`renderOptions` 当前值兜底保持不变。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；DOM 核对无 `.chip` / `.filter-chips` / `.detail-banner` 元素，列表点击与下拉框选择写入同一份筛选（AC1 见 T011 记录）。

提交：5466d63

# T005 Tab 结构与状态保持

状态：done

目标与完成条件：新增 `ModuleTabs.tsx`（`role="tablist"` / `aria-selected` / `aria-controls`），`activeTab` 默认 `'token'`，两个 `ModuleSection` 条件渲染；所有 `useQuery` 仍在顶层无条件调用；切换 tab 保留筛选、时间预设、两张表折叠状态与排序状态；首次激活两种 tab 时图表尺寸正常。对应 Spec R2、AC2 与 Plan「状态与组件结构」「实施顺序 4」。

必要依赖：T004。

修改范围：`src/web/App.tsx`、`src/web/components/ModuleTabs.tsx`、`src/web/components/ModuleSection.tsx`、`src/web/styles.css`、`vite.config.ts`（dev 代理前缀）。

实施结果：新增 `ModuleTabs`（tablist / tab / `aria-selected` / `aria-controls`，支持左右方向键并做焦点跟随）；`ModuleSection` 改为 `tabpanel`，tab id、`aria-controls` 与 `aria-labelledby` 都由 `ModuleTabs` 导出的同一组函数生成；面板 id 当时仍由 `App` 传入字面量（`token-module` / `credit-module`），`modulePanelId` 只用于 `aria-controls`，两处尚未打通，存在漂移风险（已由 T015 修复）。`activeTab` 默认 `token`，模块内容只在激活时挂载（T015 后外层两个 `tabpanel` 容器常驻，未激活的一个以 `hidden` 隐藏），`useQuery` 全部保留在组件顶层。附带修复 `vite.config.ts` 的 dev 代理前缀（`/api` → `^/api/`）：此前前端模块 `/api.ts` 被转发到 API 服务，`npm run dev` 下整页白屏，属本任务之前已存在的问题，不修无法做交互验收。

验证：`npm run typecheck`、`npm run build` 通过；dev 服务下核对两个 tab 的 `aria-selected` 与面板挂载、默认激活 Token、切换后分组筛选与时间预设保持不变、两个 tab 图表首次激活宽度均为 1232px。

提交：e73fa1c、f1caa3a

# T006 拆分列表固定行数

状态：done

目标与完成条件：用 `visibleBreakdownRows(rows, 8)` 截取，容器高度由 `--rows` 与 `--breakdown-row-height` 的 CSS `calc` 计算，JS 不硬编码像素；移除 `.breakdown-list` 的 `max-height` / `overflow: auto`，`.breakdown-row` 固定高度；「N 项」与 `tokenShare` / `creditShare` 仍按全量计算，被截断项仍可从筛选下拉选中。对应 Spec R3、AC3 与 Plan「拆分列表固定行数」。

必要依赖：T002、T005。

修改范围：`src/web/components/BreakdownList.tsx`、`src/web/styles.css`。

实施结果：列表按上限 8 截取后再渲染；行高 52px 只在 `:root` 的 `--breakdown-row-height` 定义一处，容器高度 `calc(var(--rows) * var(--breakdown-row-height))`；移除内部滚动。为空或加载态时沿用原有空态与骨架，容器高度按实际行数收缩。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；DOM 度量三个列表分别 8/64、8/214、8/10 项，行高均 52px，容器高 = 行数 × 52，`overflow-y: visible` 且 `scrollHeight === clientHeight`；被截断的 206 个对话仍可从下拉选中。

提交：1f6bcac

# T007 明细折叠与懒加载

状态：done

目标与完成条件：`useQuery` 支持 `path: string | null`，`null` 时状态为 `{ data: null, loading: false, error: null }` 且不发请求；`RequestTable` 增加 `open` / `onToggle` 与 `aria-expanded` / `aria-controls`，标题栏整行可展开收起；两表折叠状态独立、默认折叠、默认 `startedAt desc`（**API 默认排序不改**，由 `filterParams` 显式传参）；展开后表头排序可用，440px 表格内部滚动保留。对应 Spec R4、AC4 与 Plan「明细折叠与懒加载」。

必要依赖：T001、T005。

修改范围：`src/web/useQuery.ts`、`src/web/components/RequestTable.tsx`、`src/web/App.tsx`、`src/web/styles.css`。

实施结果：`useQuery` 支持 `null` 路径，折叠时不发请求且清空旧结果；`RequestTable` 标题栏改为整行 `<button aria-expanded aria-controls>`（`useId` 生成面板 id），折叠只渲染标题栏并以「点击展开」提示，展开后显示行数；两张表各持一份折叠状态，排序默认 `startedAt desc` 由前端显式传参，`getRequests` 默认排序未改。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；页面初始 `/api/requests` 请求数为 0，展开后为 1 条且带 `sort=startedAt&order=desc`；点表头「合计」发出 `sort=totalTokens&order=desc`；表格高 440px、`scrollHeight` 944px（内部滚动生效）；token 表保持展开、积分表独立为折叠，切 tab 后状态不互相覆盖。

提交：755a997

# T008 数值单位与命中率

状态：done

目标与完成条件：四个 token 指标卡、拆分列表 token 分支、明细表四个 token 列、趋势图 tooltip 与 y 轴刻度改用 `formatTokens`，趋势图不再出现「万 / 亿」；积分列继续用 `formatCredit`，积分 y 轴去掉 `1.0k`、改用 `formatInteger(Math.round(value))`；请求数 / 会话数 / 条数保持 `formatInteger`；`MetricItem` 增加可选 `suffix`，「缓存命中」卡显示 `cacheHitRate` 结果，分母为 0 时显示 `—`，不新增卡片与趋势序列。对应 Spec R5 / R6、AC5 / AC6 与 Plan「数值与命中率」。

必要依赖：T002、T006、T007。

修改范围：`src/web/App.tsx`、`src/web/components/BreakdownList.tsx`、`RequestTable.tsx`、`MetricCards.tsx`、`TrendChart.tsx`、`src/web/styles.css`。

实施结果：token 全链路改用 `formatTokens`（含 tooltip 与 y 轴），积分与计数格式不变；积分 y 轴改 `formatInteger`；`MetricItem.suffix` 渲染为数值后的 `.metric-suffix`，「缓存命中」卡传入 `cacheHitRate` 结果，`inputTokens = 0` 时传 `—`。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；页面卡片为 `5.2M / 5.2M / 46.8K / 5.0M 97.4%`，token y 轴为 `5.0M…0`；积分轴为 `0 / 100 / … / 1,000` 无 `k`；全页文本不含「万」「亿」；未来区间（无请求）命中卡片显示 `0 —`。

提交：5d3ee64

# T009 0 值隐藏

状态：done

目标与完成条件：按 `activeTab` 用 `visibleModelKeys` 过滤按模型拆分行、传给 `TrendChart` 的 `timeseries.rows`（`days` 原样保留）与模型下拉选项；按分组 / 按对话列表和请求级明细不过滤；服务层聚合 SQL 不变，维度拆分之和仍等于总览；下拉保留已选模型兜底；不显示任何隐藏提示。对应 Spec R7、AC7 / AC10 与 Plan「0 值隐藏」「实施顺序 3」。

必要依赖：T002、T003、T005。

修改范围：`src/web/App.tsx`。

实施结果：按 `activeTab` 计算可见模型键集合，统一作用于按模型拆分行、趋势图 rows（`days` 原样）与模型下拉；已选模型即使在本 tab 被隐藏也保留下拉项与展示名（优于仅回退键名）；分组 / 对话列表与请求明细不过滤；`server/query.ts` 未改动。收尾复核时补充：模型维度请求尚未返回时趋势图先不做过滤，避免与 timeseries 竞争导致首屏闪出空态。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；全部时间下 Token tab 模型下拉 10 项（缺 `hy4-preview-f`）、积分 tab 8 项（缺 `step-5-preview` / `hy3` / `glm-5.2`），两侧项数与 0 值模型数之和均为 11；选中 `hy3` 后切到积分 tab，下拉仍显示 `Hy3`；被隐藏后对应视图显示空态而非报错；页面无任何隐藏提示文案。

已知缺口（复核补充）：可见集合取自含模型筛选的 `modelRows`，却用于过滤去掉模型筛选的 `modelOptions`，实测选中某个模型后下拉只剩该模型与「全部模型」，无法直接切换；本次验收只覆盖了「已选模型仍显示」，未覆盖「选中后仍可切换」。已由复核后追加的 T014 修复（提交 `3f63e98`）。

提交：2919b93、35da5ff

# T010 刷新完成时间显示

状态：done

目标与完成条件：`header-actions` 的「刷新数据」按钮前用 `formatRefreshTime` 显示 `lastRefreshAt`，`null` 时显示「尚未刷新」；刷新成功后随现有 `version` 依赖重新取 `/api/summary` 自动更新；不新增端点、不新增状态。对应 Spec R9、AC9 与 Plan「刷新完成时间」。

必要依赖：T001、T002、T005。

修改范围：`src/web/App.tsx`、`src/web/styles.css`。

实施结果：页头在「本地数据」与刷新按钮之间显示「上次刷新 HH:mm」，无记录时显示「尚未刷新」，首屏加载中不显示占位（避免把加载态误报为未刷新）；未新增端点与状态。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；页面首屏显示 `上次刷新 18:30` 与服务端 `meta.last_refresh_at` 一致；点击刷新后服务端时间戳前进，页面自动更新为 `上次刷新 18:31`。「尚未刷新」分支由代码路径确认（运行中的服务启动即刷新，实际不会出现该状态）。

提交：099f217

# T011 文档同步与收尾验收

状态：done

目标与完成条件：按实现结果更新 `product-brief.md`（范围段与成功标准措辞）、`technical-architecture.md`（面板层描述、`/api/summary` 接口表、Hono 依赖行措辞）、`data-model.md`（C12 展示名冲突规则、结构版本）；核对两份 Spec、本 Plan、Tasks 与长期文档无矛盾，删除不再适用的说明；按 Spec AC1–AC11 逐条验收，其中 DOM 与 ECharts 交互按 Plan「前端交互验收」用 `npm run dev` 手工核对并记录；全量执行 `npm run typecheck`、`npm test`、`npm run build`；逐项完成 AGENTS.md 第 5 节收尾检查，并一次性回填 T001–T010 的「提交」字段（本任务不填该字段）。对应 Plan「实施顺序 5」「测试策略」「影响范围」。

必要依赖：T001–T010。

修改范围：`docs/`、`docs/delivery/usage-panel-polish-tasks.md`。

实施结果：

- `product-brief.md`：范围段改为「Token 与积分分成两个 tab + 四个共用筛选 + 明细默认折叠按时间降序」；成功标准把「一次下钻到位」替换为「首屏可读」与「筛选即视图」两条。
- `technical-architecture.md`：面板层改为「两个 tab、共用一组筛选栏」；分层原则补「0 值隐藏与列表截断只影响展示」；Hono 依赖行去掉「端点会随下钻增加」；`/api/summary` 接口表补 `lastRefreshAt`；开发部署说明补代理前缀 `^/api/` 的原因。
- `data-model.md`：`models` 表说明补规范化后的重名冲突规则（组内按标识字典序，首项保留，其余 `规范化名 (标识)`）；C12 补冲突处理；版本管理补「展示名这类派生规则变化也需递增，本次 1 → 2」。
- `devops.md`：开发与生产入口分开（dev 为 5173、生产为 4620），补 Vite proxy 只转发 `^/api/` 的约束与原因，并注明项目未配置 lint。
- `docs/backlog/subagent-credit-reconciliation.md` 与本交付无关，未改动；`integration.md` 本交付不涉及。

验证（AC1–AC11，`npm run dev` + 无头 Chrome 经 CDP 驱动本地页面与 API 逐条核对；当时的驱动脚本为一次性临时工具、未入库，截图输出到临时目录、同样不入库；脚本已由 T018 整理为 `scripts/panel-acceptance.mjs`，可由 `npm run acceptance` 复跑，断言项与结果如下）：

- **AC1 通过**：界面无 `.chip` / `.detail-banner`；列表点击与下拉框选择写入同一份筛选，两者发出的 `/api/summary` 查询串完全一致；重置按钮在筛选后启用，重置回到初始状态。
- **AC2 通过**：默认激活 Token；设置时间预设、模型筛选、展开明细并改排序后切到积分再切回，预设 / 筛选 / 折叠 / 排序全部保留；两个 tab 首次激活时图表宽度均 1232px。
- **AC3 通过**：三个列表 8/64、8/214、8/10 项，行高 52px、容器高等于行数 × 52、无内部滚动；「N 项」为全量项数；被截断的 206 个对话仍可从下拉选中。
- **AC4 通过**：两张表默认折叠且状态独立；折叠时无 `/api/requests` 请求；展开后按 `startedAt desc` 请求并可点表头切换排序；表格保留 440px 内部滚动。
- **AC5 通过**：token 数值（卡片 / 拆分 / 明细 / tooltip / y 轴）均为 K/M/B，页面文本无「万」「亿」；积分与计数格式不变，积分轴无 `k`；无任何数值型 `title`，不存在精确值 hover。
- **AC6 通过**：页面「缓存命中」卡 `5.0M 97.4%`，与 `cacheReadTokens / inputTokens = 5 035 584 / 5 167 808` 手算一致；无请求时显示 `0 —`；积分模块无该后缀、无按天趋势。
- **AC7 通过（有缺口）**：Token tab 隐藏 `totalTokens = 0` 的 `hy4-preview-f`，积分 tab 隐藏 `credit = 0` 的 `step-5-preview` / `hy3` / `glm-5.2`，而 `hy4-preview-f` 因有积分在积分 tab 保留；下拉与拆分项同步过滤；无任何提示文案。缺口：选中某个模型后下拉只剩该模型，无法直接切换，属可见集合口径问题，已由 T014 修复（提交 `3f63e98`）。
- **AC8 通过**：`hy4` 与 `hy4-free` 仍为两个业务键，展示名为 `Hy4` 与 `Hy4 (hy4-free)`；连续两次删库全量重建结果逐字节一致；增量刷新不回退由单测覆盖。
- **AC9 通过**：首屏显示 `上次刷新 18:30` 与服务端一致；触发刷新后服务端时间戳前进、页面更新为 `上次刷新 18:31`；无刷新记录显示「尚未刷新」（代码路径 + 接口单测覆盖）。
- **AC10 通过**：全部时间无筛选下，分组 / 模型 / 对话三个维度的 token 与积分之和均等于总览（token 174 089 537、积分 5 783.62）；被隐藏的 0 值模型贡献为 0，展示截断不改变合计。
- **AC11 通过**：v1 的 AC1–AC10 由 `tests/acceptance.test.ts` 继续覆盖并通过；v1 AC11 的界面结构由本 Spec 覆盖。

全量检查：`npm run typecheck` 通过；`npm test` 11 个文件 86 项通过；`npm run build` 通过（服务端 `tsc` + 前端 `vite build`）。项目无 lint 脚本，未执行 lint（原因见 `devops.md`）。

收尾检查（AGENTS.md 第 5 节）：Spec 验收标准已逐条满足；Tasks 状态与实施记录已更新，T001–T010 提交字段已回填；测试与类型检查通过；三份长期文档已按实现更新且与代码无矛盾；复核发现的代码与验收细节问题改为追加 T012–T018 在本流程内修复，不新增其它文档；`subagent-credit-reconciliation.md` 与本交付无关、保持原状。

## 复核后修订（2026-11-12）

交付复核指出若干文档问题，经逐条核对属实后修订，均不改变需求范围与验收标准：

- Spec R3 原写「排序仍在服务端完成，前端只截取前 8 行」，与实现不符：服务端只按 `total_tokens` 降序返回，积分模块在前端按 `credit` 重排。已按实情改写；Plan「纯函数下沉」中 `visibleBreakdownRows` 的排序表述同步修正。
- Spec、Plan 与 `group-normalization-spec.md` 曾在 `e97c94a`（Tasks 提交）中一并做过复核澄清（结构版本链、v1 R8 编号、AC11 口径等），该提交正文有说明，但文档内没有确认记录。本次修订同样只做事实澄清，不改需求与验收范围。
- Spec「待确认问题」仍留「等待开发者确认后进入 Plan」的过期句子，改为指向本 Tasks 文档。
- Plan「影响范围」原写「不改构建配置」，与实际修改 `vite.config.ts`（dev 代理前缀）矛盾；已补入修改清单并说明原因，「不改」范围改为构建产物配置。Plan 与 Spec 的文档影响范围同时补上 `devops.md`。
- Tasks 修改范围补记漏项：T005 补 `ModuleSection.tsx` / `vite.config.ts`，T007 / T008 / T010 补 `styles.css`；T005 的两个提交按时间顺序改为 `e73fa1c`、`f1caa3a`。
- T005 原称「tab 与面板 id 由同一组函数生成」只对了一半：面板 id 仍由 `App` 传入字面量，已按实情改写。
- 长期文档：`technical-architecture.md` 的分层原则与 AD-4 补「缓存命中率是唯一的前端求值项」；`product-brief.md` 核心问题删去与「非目标」冲突的「命中率是否随使用改善」；`devops.md` 修正 dev / 生产入口并补代理前缀约束与无 lint 的事实；`data-model.md` 补「新增字典序更小的同组标识会让原首项改名」的已知行为。
- 复核发现的代码与验收细节问题（模型下拉塌缩、非激活 tab 的 `aria-controls` 悬空、面板 id 未与 `modulePanelId` 打通、配色随 tab 漂移、`visibleModelKeys` 用 `> 0` 与 R7 的 `=== 0` 表述差异、两处测试名实不符、`formatTokens(999_999)` 输出 `1000.0K`、验收脚本未入库）不新增文档，改为在本流程追加 T012–T018 逐项修复（均已完成，见各任务记录）；此前临时创建的 backlog 条目已删除。

### 二次复核修订（2026-11-12）

二次复核确认 T012–T018 的实现与验证记录属实，同时发现修复引入的新矛盾与仍待同步的表述，按实情修订，不改变需求范围与验收标准：

- Spec R2 与 Plan「状态与组件结构」仍写「未激活 tab 不挂载 DOM」「只挂载激活 tab 的 DOM」，Plan 关键取舍与风险表也写「只挂载激活 tab」，与 T015 的「两个 tabpanel 容器常驻、未激活用 `hidden` 隐藏、模块内容只在激活时挂载」不符；已统一改写。
- Plan「纯函数下沉」的 `visibleModelKeys` 仍是 `> 0`，与 T013 的 `!== 0` 不符；测试策略、关键取舍与风险表仍按「无自动化交互验收」描述，与 T018 入库的验收脚本不符；影响范围补记 `scripts/panel-acceptance.mjs` 与 `package.json` 的 `acceptance` 入口。均已同步。
- T005 实施结果中「记入 backlog」指向已删除的临时条目，T011 验证段「脚本未入库」也已过时，均补上后续修复指向；历史数值与提交记录保持原样。
- Spec R5 补 `≥10¹²` 时 B 为最大单位、显示 `1000.0B` 的上界；「已确认决策」补色位按不带筛选的全量模型集合固定。
- 流程说明：`7680f6f` 曾新建 `docs/backlog/panel-display-fixes.md`，`09a98d7` 在 T012 的提交中一并删除（该提交正文未单列此项）；`7680f6f` 关联已完成的 T011 并回改了 T011 的验证与收尾记录；`e97c94a` 与 `7680f6f` 对已确认 Spec / Plan 的澄清均为事实勘误，未在文档内留下独立审批记录。历史提交不改写，此处只作如实补充；本轮修订由开发者授权，在同一交付内以 T019–T021 完成，归档前如需独立审批节点由开发者补记。
- 归档仍未进行：三份交付文档留在 `docs/delivery/` 顶层，无版本 tag，`package.json` 仍为 1.0.0；待开发者确认发布后按 AGENTS.md 第 7 节归档。

# T012 K/M/B 进位边界

状态：done

目标与完成条件：`formatTokens` 在四舍五入后达到 `1000.0` 时进位到上一单位（`999_999` → `1.0M`），未达进位阈值时保持原单位（`999_000` → `999.0K`），小于 10³ 仍显示整数；`tests/display.test.ts` 更新临界值断言并补进位用例；Spec R5 同步该规则。对应复核意见「`formatTokens(999_999)` 输出 `1000.0K` 与数值易读目标相悖」。

修改范围：`src/web/format.ts`、`tests/display.test.ts`、`docs/delivery/usage-panel-polish-spec.md`。

实施结果：`formatTokens` 改为按进位后的数值选单位：`999_990` / `999_999` / `999_999_999` 输出 `1.0M` / `1.0M` / `1.0B`，`999_000` 仍为 `999.0K`，负值同规则（`-999_999` → `-1.0M`）。

验证：`npm run typecheck`；`npx vitest run tests/display.test.ts` 13 项通过（含进位与负值用例）。

提交：09a98d7

# T013 0 值判定的正负语义

状态：done

目标与完成条件：`visibleModelKeys` 由 `metric > 0` 改为 `metric !== 0`，与 Spec R7「过滤 `=== 0` 的模型」一致，负值视为可见；`tests/display.test.ts` 补 0 隐藏、正值可见、负值可见三类断言。对应复核意见「判定口径微差、负值无单测覆盖」。

修改范围：`src/web/display.ts`、`tests/display.test.ts`。

实施结果：`visibleModelKeys` 判定改为 `metric !== 0`，只隐藏恰好为 0 的模型，负值视为可见。

验证：`npm run typecheck`；`npx vitest run tests/display.test.ts` 14 项通过（补负值可见断言）。

提交：8c9dc56

# T014 模型下拉可见集合口径

状态：done

目标与完成条件：0 值判定改用「当前时间 / 分组 / 对话筛选、不含模型筛选」的模型结果（`modelOptions`），同一集合统一作用于趋势图、按模型拆分与模型下拉；选中任意模型后下拉仍保留全部可切换项，切换后过滤结果仍随当前 tab 主指标变化；Spec R7 与 AC7 补判定集合与可切换要求。对应复核意见「0 值隐藏的下拉口径混用，选中模型后下拉塌缩」。

必要依赖：T013。

修改范围：`src/web/App.tsx`、`docs/delivery/usage-panel-polish-spec.md`。

实施结果：可见集合改用「时间 / 分组 / 对话筛选、不含模型筛选」的 `modelOptions` 计算，统一作用于趋势图、按模型拆分与下拉；已选模型即使在本 tab 为 0 也保留下拉项；Spec R7 与 AC7 补判定集合与可切换要求。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；全部时间下 Token 下拉 10 项，选中 `hy4` 后仍 10 项并可切换到 `hy3`；积分 tab 为 8 项 + 已选模型 1 项；切 tab 后筛选保留。

提交：3f63e98

# T015 tab 与面板 ARIA 关联

状态：done

目标与完成条件：两个 `tabpanel` 容器常驻页面，未激活时用 `hidden` 隐藏，`aria-controls` 始终指向存在的 id；面板 id 由 `modulePanelId` 生成，`aria-labelledby` 由 `moduleTabId` 生成，不再由调用方手写字面量；未激活 tab 仍不挂载模块内容，ECharts 不在零尺寸容器中初始化；`ModuleSection` 去掉 `id` / `role` / `aria-labelledby`。对应复核意见「`aria-controls` 引用悬空、面板 id 未与 `modulePanelId` 打通」。

修改范围：`src/web/App.tsx`、`src/web/components/ModuleSection.tsx`。

实施结果：两个 `tabpanel` 容器常驻并用 `hidden` 标记未激活，id 由 `modulePanelId` 生成、`aria-labelledby` 由 `moduleTabId` 生成；`ModuleSection` 去掉 `id` / `role` / `aria-labelledby`；未激活面板不挂载模块内容。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；DOM 核对两个 `aria-controls` 目标均存在、未激活面板 `hidden` 且 `section` 数为 0、页面 canvas 始终为 1；截图确认布局无额外空档。

提交：48c1ad9

# T016 趋势图配色稳定

状态：done

目标与完成条件：配色索引按「当前筛选下（不含模型筛选）按展示名排序的模型序列」确定，与当前 tab 的可见集合无关；同一模型在 Token / 积分 tab 颜色一致；新增纯函数覆盖排序与去重，`tests/display.test.ts` 补用例；`TrendChart` 通过可选配色索引接收映射，缺省回退原行为。对应复核意见「模型配色随 tab 漂移」。

修改范围：`src/web/display.ts`、`src/web/App.tsx`、`src/web/components/TrendChart.tsx`、`tests/display.test.ts`。

实施结果：新增 `modelColorIndex`：按展示名（同名按业务键）固定模型色位；`TrendChart` 接收可选 `colorIndex`，两个 tab 传入同一映射，缺省回退原行为。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；`tests/display.test.ts` 17 项通过；截图核对同一模型在两个 tab 图例中均为蓝色。

提交：24d7559

# T017 测试命名与断言强度

状态：done

目标与完成条件：`tests/acceptance.test.ts` 的 `AC11 界面结构` 改为如实描述（该用例只断言首屏所需的服务层聚合数据，界面结构由本 Spec 的验收记录覆盖）；`tests/api.test.ts`「与筛选无关」用例改为比对带筛选与不带筛选的 `lastRefreshAt` 相等，而不只断言类型。对应复核意见「测试名实不符」。

修改范围：`tests/acceptance.test.ts`、`tests/api.test.ts`。

实施结果：`tests/acceptance.test.ts` 的 `AC11 界面结构` 改为 `AC11 首屏数据完整性` 并如实描述断言范围；`tests/api.test.ts` 的刷新时间用例改为比对带筛选与不带筛选的 `lastRefreshAt` 相等。

验证：`npm run typecheck`；`npx vitest run tests/api.test.ts tests/acceptance.test.ts` 27 项通过。

提交：3c92f18

# T018 验收脚本入库

状态：done

目标与完成条件：把 CDP 驱动的交互验收整理为 `scripts/panel-acceptance.mjs`，覆盖 AC1–AC7 的关键 DOM 断言（tab 与 ARIA、筛选两入口、拆分列表行数与滚动、明细折叠与懒加载、数值单位、命中率、0 值隐藏与下拉可切换），逐项打印 PASS/FAIL 并以退出码反映结果；`devops.md` 记录启动调试 Chrome 与运行脚本的步骤；脚本不引入依赖、不改产品代码。对应复核意见「验收证据不可复现」。

修改范围：`scripts/panel-acceptance.mjs`、`docs/devops.md`、`package.json`。

实施结果：新增 `scripts/panel-acceptance.mjs`（CDP + Node 内置 WebSocket，无新依赖），7 项断言；`package.json` 增加 `acceptance` 入口；`devops.md` 记录启动调试 Chrome 与运行步骤。

验证：`npm run typecheck`、`npm test`、`npm run build` 通过；`npm run acceptance` 7/7 PASS（tab 与 ARIA、拆分列表、明细折叠、单位、命中率、筛选两入口、0 值隐藏与下拉可切换）。

提交：c725b46

# T019 文档同步与口径勘误

状态：done

目标与完成条件：修正 T015 / T018 之后 Spec 与 Plan 中「未激活 tab 不挂载 DOM」「只挂载激活 tab」「可见集合 `> 0`」「交互验收依赖人工」等过时表述；Spec R5 补 `≥10¹²` 上界、「已确认决策」补配色稳定口径；Plan 影响范围补验收脚本与 `acceptance` 入口；T005 / T011 的过期记录补上后续修复指向；如实补充二次复核的流程说明。不改变需求范围与验收标准，不改写历史提交。

修改范围：`docs/delivery/usage-panel-polish-spec.md`、`docs/delivery/usage-panel-polish-plan.md`、`docs/delivery/usage-panel-polish-tasks.md`。

实施结果：Spec R2 改为「两个 tabpanel 容器常驻、未激活 `hidden` 空壳、模块内容与 ECharts 只在激活时挂载」；Plan 的关键取舍、风险表、测试策略、影响范围与「状态与组件结构」同步；`visibleModelKeys` 改为 `!== 0`；新增「配色稳定」技术方案小节说明全量模型集合与 0 值判定集合互不混用。T005 去掉指向已删除 backlog 的「记入 backlog」并补 T015 修复结果，T011 验证段补 T018 入库说明；新增「二次复核修订」节记录临时 backlog 的新建 / 删除、T011 记录回改与 Spec / Plan 事后澄清缺少独立审批记录，以及归档仍待开发者确认发布。

验证：`npm run typecheck`、`npm test`（11 文件 91 项）、`npm run build` 通过；`npm run acceptance` 7/7 PASS；逐条核对 Spec 与 Plan 的正面表述已按实情更新（Tasks 中保留的旧措辞仅为修订说明中的引用）。

提交：

# T020 配色跨筛选稳定

状态：done

目标与完成条件：色位按不带筛选的全量模型集合固定，切换 tab、0 值隐藏与改变时间 / 分组 / 对话筛选都不改变同一模型的颜色；不改统计口径、不改 API 契约、不新增依赖；Spec 与 Plan 同步该口径。对应二次复核意见「筛选改变模型成员时色位重编号导致换色」。

修改范围：`src/web/App.tsx`、`docs/delivery/usage-panel-polish-spec.md`、`docs/delivery/usage-panel-polish-plan.md`。

实施结果：新增一次不带筛选的 `GET /api/breakdown?dim=model` 查询（路径固定，只随 `version` 重取），`modelColors` 改由该全量集合计算；`modelColorIndex` 纯函数与 `TrendChart` 不变。0 值隐藏的判定集合仍是带时间 / 分组 / 对话筛选的 `modelOptions`，两者互不混用；全量集合返回前图表沿用可见集合顺序，返回后色位固定。

验证：`npm run acceptance` 7/7 PASS（AC7 新增「全部时间 → 今天」前后同名模型颜色一致比对）；`npm run typecheck`、`npm test`（11 文件 91 项）、`npm run build` 通过。

提交：

# T021 验收脚本断言补全

状态：done

目标与完成条件：AC2 断言 canvas 数为 1、非激活面板恰有一个且 id 对应未激活 tab 的 `aria-controls`；AC5 补趋势图 y 轴刻度与 tooltip 的「万 / 亿」检查并让 token 数值正则允许整数千分位；AC7 补积分轴无 `k` 与配色跨筛选稳定；`devops.md` 同步覆盖范围。对应二次复核意见「验收脚本断言缺口」。

修改范围：`scripts/panel-acceptance.mjs`、`docs/devops.md`。

实施结果：新增 `readChart`，从页面已加载的 ECharts 实例读取 y 轴 formatter、tooltip formatter 与 series 颜色（无新依赖、不改产品代码）；AC2 补 canvas 数与 hidden 面板对应关系，AC5 补刻度与 tooltip 并放宽正则，AC7 补积分刻度与配色跨筛选比对；仍为 7 项 check，逐项 PASS/FAIL 与退出码行为不变。

验证：`npm run acceptance` 7/7 PASS；`npm run typecheck`、`npm test`、`npm run build` 通过。

提交：
