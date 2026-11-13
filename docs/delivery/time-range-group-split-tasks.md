本 Tasks 对应 [time-range-group-split-spec.md](./time-range-group-split-spec.md) 与 [time-range-group-split-plan.md](./time-range-group-split-plan.md)。任务编号稳定，不表示必须严格串行；实施时按 AGENTS.md 第 4 节逐个完成并逐个提交。

## 执行顺序与依赖

- T001 是**纯增量**：新增共享规则与可选字段，不删 `TimeseriesResponse.days`。`days` 的删除必须与所有消费方一起放在 T006，保证其间每一步 `npm run typecheck` 都能通过。
- T002 / T003 / T004 在 T001 之后互不依赖；T002 与 T003 都涉及 `server/app.ts`，按编号先后实施。
- T005 依赖 T004 的预设函数与 T001 的共享跨度规则；T006 依赖 T005 建立的「`from / to` 始终有值且合法」状态模型。
- T007 只依赖 T001，可与 T005 / T006 并行；T008 需等 T003、T006、T007 全部就绪。
- T009 依赖全部前端改动；T010 为收尾任务，依赖 T001–T009。
- 影响正确性、兼容性或类型检查的顺序约束见 Plan「顺序约束」，本文件不重复。

# T001 共享跨度规则与类型增量

状态：done

目标与完成条件：按 Spec R11 与 Plan「跨度校验与面板层补轴」建立单一共享规则（`MAX_RANGE_DAYS = 100`、`daySpan(from, to)` 用 UTC 计含首尾天数），`enumerateDays` 及其 3700 guard 保持不变；按 Plan「接口归位」「服务层：附加交叉聚合」补齐 `BreakdownSegment` 与 `BreakdownRow.models?`。本任务不删 `TimeseriesResponse.days`（留待 T006），完成条件含共享层相关单测与 `npm run typecheck` 通过。

修改范围：`src/shared/constants.ts`、`src/shared/dates.ts`、`src/shared/types.ts`、`tests/shared.test.ts`

实施结果：`constants.ts` 新增 `MAX_RANGE_DAYS = 100`；`dates.ts` 新增 `daySpan()`（UTC 解析、`Math.round` 折算天数后 `+1`，`enumerateDays` 与 guard 未动）；`types.ts` 新增 `BreakdownSegment` 与可选 `BreakdownRow.models`，`TimeseriesResponse.days` 保留。单测新增「区间跨度」四项（含首尾、跨月年、时区 / 夏令时、100 / 101 边界）与「分组行可附带按模型分段」一项。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/shared.test.ts` 10 项通过。

# T002 服务层跨度校验

状态：done

目标与完成条件：按 Spec R11 与 Plan「API 契约兜底」在 `readFilters` 增加校验：`from` 与 `to` 都存在且跨度超限时返回 400 与「时间跨度不能超过 100 天」，四个筛选端点一致；缺失任一日期时放行，保留 API 不带日期取全量的能力。完成条件含 100 / 101 天边界、单侧日期与无日期请求的行为符合 Spec 边界表，相关 API 单测与 `npm run typecheck` 通过。

必要依赖：T001

修改范围：`server/app.ts`、`tests/api.test.ts`

实施结果：`readFilters` 在「格式校验 → `from > to`」之后追加 `daySpan(from, to) > MAX_RANGE_DAYS` 判断，返回 `{ ok: false, error: '时间跨度不能超过 100 天' }`，各端点沿用既有 400 分支；缺失任一日期不校验。`tests/api.test.ts` 新增 `FILTERED_PATHS` 与 `withQuery()`，对 4 个筛选端点断言 100 天 200、101 天 400 且文案一致，单侧日期与无日期请求放行。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/api.test.ts` 14 项通过。

必要的问题与决策：Spec / Plan / T002 原文写「五个端点」，实际只有 4 个端点调用 `readFilters`（`server/app.ts:71`、`79`、`91`、`107`；`/api/health` 不解析筛选）。按「所有读取筛选的端点一致」实现，并在收尾时把文档口径改为「四个筛选端点」，不改变校验范围与验收含义。

# T003 分组维度交叉聚合

状态：done

目标与完成条件：按 Spec R4 与 Plan「服务层：附加交叉聚合」实现 `split=model`（仅 `dim=group` 生效，非法值 400），复用同一 `where / params / GROUP_KEY` 追加第二条查询，把按模型分段挂到 `BreakdownRow.models`；不改原聚合 SQL、不改 `tokenShare / creditShare`、不改派生库结构与 `SCHEMA_VERSION`。完成条件含「每行段之和 = 行值」、其它维度与不带 `split` 时无 `models`、模型筛选时段收敛、C14 不含内部 id。

必要依赖：T001

修改范围：`server/app.ts`、`server/query.ts`、`tests/api.test.ts`

实施结果：`getBreakdown()` 增加可选 `withModelSplit`，仅在 `dimension === 'group'` 时调用新增的 `attachModelSegments()`：第二条查询复用 `BASE_FROM` / `where` / `params` / `GROUP_KEY`，按 `group_key, m.id` 分组，结果按分组键归并挂到 `row.models`（无分段给 `[]`）；原聚合 SQL、`tokenShare` / `creditShare` 与表结构未改。`/api/breakdown` 读取 `split` 参数，非 `model` 值返回 400，其它维度忽略该参数。新增 `tests/helpers/segment-fixture.ts`（alpha 分组由 model-a 300 + model-b 100 构成）覆盖多模型分组。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/api.test.ts` 18 项通过（新增 4 项：段之和等于行值、不带 split / 其它维度无 `models` 且聚合不变、模型筛选收敛、非法 split 400 与 C14）。

# T004 时间预设纯函数

状态：pending

目标与完成条件：按 Spec R1 / R3 与 Plan「时间纯函数」把 `PresetKey` 收敛为四个预设（保留「今天」、新增「3 天」），提供 `QUICK_PRESETS` 与 `DEFAULT_PRESET = 'threeDays'`，`rangeForPreset` 去掉 `custom` 参数与 `month / all / custom` 分支，新增 `matchPreset` 做区间反向匹配；`applyPresetRange` 行为不变。完成条件含四个区间、`matchPreset` 命中与未命中、切换时间保留三个维度筛选，旧预设用例按新契约改写。

必要依赖：T001

修改范围：`src/web/filters.ts`、`tests/filters.test.ts`

# T005 时间控件与跨度拦截

状态：pending

目标与完成条件：按 Spec 行为 1–5、R1 / R2 / R3 / R11、AC1–AC3 / AC9 与 Plan「App 与 FilterBar」把时间区改为四个快捷按钮 + 常驻起止框，删除 `preset / custom` 状态，以 `filters.from / to` 为唯一真相；`handleRange` 在空值、顺序颠倒、跨度超限时分别回弹或显示错误且不写入 `filters`；快捷按钮、重置、错误提示、`aria-pressed` 与三个维度筛选的保留行为符合 Spec。完成条件含默认与重置为近 3 天、按钮与日期双向联动、非法区间不产生有效查询。

必要依赖：T001、T004

修改范围：`src/web/App.tsx`、`src/web/components/FilterBar.tsx`、`src/web/styles.css`

# T006 日期轴职责归位

状态：pending

目标与完成条件：按 Spec R9 / R10、AC6 / AC8 与 Plan「接口归位」「面板层补轴」删除 `TimeseriesResponse.days`、`getTimeseries` 只返回 `rows`；新增前端 `TrendChartData` 与 `buildTimeseriesAxis`（跨度 ≤ 100 天时逐天补 0），`TrendChart` 的渲染逻辑与 `panel-meta` 文案不变。字段删减必须与所有消费方在同一任务完成，保证 `npm run typecheck` 通过。完成条件含 `/api/timeseries` 响应不含 `days`、选近 7 天时画满 7 格、空 `rows` 走空态。

必要依赖：T001、T005

修改范围：`src/shared/types.ts`、`server/query.ts`、`src/web/display.ts`、`src/web/App.tsx`、`src/web/components/TrendChart.tsx`、`tests/api.test.ts`、`tests/display.test.ts`

# T007 分段纯函数

状态：pending

目标与完成条件：按 Spec R5 / R7 与 Plan「分段纯函数下沉」实现按当前主指标的段过滤（值 > 0 且属于可见模型集合）、降序与稳定排序、段宽分摊（各段宽度之和等于原单色条宽）。完成条件含 0 值过滤、行值为 0、负值、无段、宽度和等边界由单测覆盖，且不改变任何聚合值。

必要依赖：T001

修改范围：`src/web/display.ts`、`tests/display.test.ts`

# T008 分组条分段着色与明细提示

状态：pending

目标与完成条件：按 Spec 行为 6–9、R5 / R6 / R8、AC4 / AC5 与 Plan「BreakdownList 分段与明细提示」给两个 tab 的「按分组」列表加按模型色段与整行浮出提示；`groupRows` 请求带 `split=model`，「按对话 / 按模型」保持单色；点击行仍是筛选，固定行高、8 行截断、「N 项」与占比不变。完成条件含段色与趋势图逐值一致、hover 与键盘 focus 都触发、提示内容与数值格式符合 Spec、分组原始路径改由浮层承载。

必要依赖：T003、T006、T007

修改范围：`src/web/components/BreakdownList.tsx`、新增 `src/web/components/BreakdownTooltip.tsx`、`src/web/App.tsx`、`src/web/styles.css`

# T009 交互验收脚本适配

状态：pending

目标与完成条件：按 Spec AC1–AC9 与 Plan「验收脚本适配」把 `setPreset` 改造为 `clickQuick / setRange / setWideRange`（宽区间起点从 `rows` 取最小 `date`），改写依赖 `#filter-preset` 的下拉与布局断言，补齐时间联动、日期轴归位、跨度上限与分段提示断言；脚本不引入依赖、不改产品代码，`npm run acceptance` 全项通过。同步 `docs/devops.md` 的覆盖范围与取数说明，并写明数据跨度超过 100 天时如何调整验收取数。

必要依赖：T005、T006、T008

修改范围：`scripts/panel-acceptance.mjs`、`docs/devops.md`

# T010 文档同步与收尾全量检查

状态：pending

目标与完成条件：按 AGENTS.md 第 5 节与 Spec「与既有交付的关系」逐项收尾：更新 `product-brief.md`、`technical-architecture.md`、`docs/model-colors.md`，核对 Spec / Plan / Tasks 与长期文档无矛盾、删除过时说明，检查 `docs/backlog/` 相关条目；按 Spec AC1–AC9 逐条验收；全量执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`；一次性回填 T001–T009 的提交字段。本任务为收尾任务。

必要依赖：T001–T009

修改范围：`docs/`、`docs/delivery/time-range-group-split-tasks.md`
