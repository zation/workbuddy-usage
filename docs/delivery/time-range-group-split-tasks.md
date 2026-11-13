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

提交：82416fe

# T002 服务层跨度校验

状态：done

目标与完成条件：按 Spec R11 与 Plan「API 契约兜底」在 `readFilters` 增加校验：`from` 与 `to` 都存在且跨度超限时返回 400 与「时间跨度不能超过 100 天」，四个筛选端点一致；缺失任一日期时放行，保留 API 不带日期取全量的能力。完成条件含 100 / 101 天边界、单侧日期与无日期请求的行为符合 Spec 边界表，相关 API 单测与 `npm run typecheck` 通过。

必要依赖：T001

修改范围：`server/app.ts`、`tests/api.test.ts`

实施结果：`readFilters` 在「格式校验 → `from > to`」之后追加 `daySpan(from, to) > MAX_RANGE_DAYS` 判断，返回 `{ ok: false, error: '时间跨度不能超过 100 天' }`，各端点沿用既有 400 分支；缺失任一日期不校验。`tests/api.test.ts` 新增 `FILTERED_PATHS` 与 `withQuery()`，对 4 个筛选端点断言 100 天 200、101 天 400 且文案一致，单侧日期与无日期请求放行。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/api.test.ts` 14 项通过。

必要的问题与决策：Spec / Plan / T002 原文写「五个端点」，实际只有 4 个端点调用 `readFilters`（`server/app.ts:71`、`79`、`91`、`107`；`/api/health` 不解析筛选）。按「所有读取筛选的端点一致」实现，并在收尾时把文档口径改为「四个筛选端点」，不改变校验范围与验收含义。

提交：fe4d254

# T003 分组维度交叉聚合

状态：done

目标与完成条件：按 Spec R4 与 Plan「服务层：附加交叉聚合」实现 `split=model`（仅 `dim=group` 生效，非法值 400），复用同一 `where / params / GROUP_KEY` 追加第二条查询，把按模型分段挂到 `BreakdownRow.models`；不改原聚合 SQL、不改 `tokenShare / creditShare`、不改派生库结构与 `SCHEMA_VERSION`。完成条件含「每行段之和 = 行值」、其它维度与不带 `split` 时无 `models`、模型筛选时段收敛、C14 不含内部 id。

必要依赖：T001

修改范围：`server/app.ts`、`server/query.ts`、`tests/api.test.ts`

实施结果：`getBreakdown()` 增加可选 `withModelSplit`，仅在 `dimension === 'group'` 时调用新增的 `attachModelSegments()`：第二条查询复用 `BASE_FROM` / `where` / `params` / `GROUP_KEY`，按 `group_key, m.id` 分组，结果按分组键归并挂到 `row.models`（无分段给 `[]`）；原聚合 SQL、`tokenShare` / `creditShare` 与表结构未改。`/api/breakdown` 读取 `split` 参数，非 `model` 值返回 400，其它维度忽略该参数。新增 `tests/helpers/segment-fixture.ts`（alpha 分组由 model-a 300 + model-b 100 构成）覆盖多模型分组。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/api.test.ts` 18 项通过（新增 4 项：段之和等于行值、不带 split / 其它维度无 `models` 且聚合不变、模型筛选收敛、非法 split 400 与 C14）。

提交：e25c074

# T004 时间预设纯函数

状态：done

目标与完成条件：按 Spec R1 / R3 与 Plan「时间纯函数」把 `PresetKey` 收敛为四个预设（保留「今天」、新增「3 天」），提供 `QUICK_PRESETS` 与 `DEFAULT_PRESET = 'threeDays'`，`rangeForPreset` 去掉 `custom` 参数与 `month / all / custom` 分支，新增 `matchPreset` 做区间反向匹配；`applyPresetRange` 行为不变。完成条件含四个区间、`matchPreset` 命中与未命中、切换时间保留三个维度筛选，旧预设用例按新契约改写。

必要依赖：T001

修改范围：`src/web/filters.ts`、`tests/filters.test.ts`

实施结果：`PresetKey` 收敛为 `today / threeDays / sevenDays / thirtyDays`，`PRESETS` 与 `CustomRange` 移除，改为 `QUICK_PRESETS`（标签「今天 / 3 天 / 7 天 / 30 天」）与 `DEFAULT_PRESET`；`rangeForPreset(preset, today)` 按含首尾天数回推，新增 `matchPreset()` 对四个预设区间做字符串精确比对；`applyPresetRange` / `hasActiveFilters` 未改。单测改写为五个用例：切换保留维度筛选、四个区间、按钮顺序与默认值、命中与未命中、端点只匹配一侧不算命中。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/filters.test.ts` 5 项通过。

必要的问题与决策：本任务与 T005 合并为一个提交。只改 `filters.ts` 会让 `App.tsx` / `FilterBar.tsx` 仍引用 `PRESETS`、`CustomRange` 与三参 `rangeForPreset`，中间状态必然 `typecheck` 失败，与 Plan「每个任务完成后单独跑 typecheck」冲突；两项同属「时间状态收敛为 `from / to`」这一原子变更，按 AGENTS.md 第 6 节合并提交并同时填写 T004、T005。

提交：a96b460

# T005 时间控件与跨度拦截

状态：done

目标与完成条件：按 Spec 行为 1–5、R1 / R2 / R3 / R11、AC1–AC3 / AC9 与 Plan「App 与 FilterBar」把时间区改为四个快捷按钮 + 常驻起止框，删除 `preset / custom` 状态，以 `filters.from / to` 为唯一真相；`handleRange` 在空值、顺序颠倒、跨度超限时分别回弹或显示错误且不写入 `filters`；快捷按钮、重置、错误提示、`aria-pressed` 与三个维度筛选的保留行为符合 Spec。完成条件含默认与重置为近 3 天、按钮与日期双向联动、非法区间不产生有效查询。

必要依赖：T001、T004

修改范围：`src/web/App.tsx`、`src/web/components/FilterBar.tsx`、`src/web/styles.css`

实施结果：`App` 删除 `preset` / `custom` 状态，`filters` 初始化为 `rangeForPreset(DEFAULT_PRESET, today)`；`handleQuick()` 走 `applyPresetRange` 保留三个维度筛选，`handleRange()` 对空值直接返回、`from > to` 与 `daySpan > MAX_RANGE_DAYS` 只设 `rangeError` 不写状态，`handleReset()` 回到近 3 天并清空维度筛选，`activePreset` 由 `matchPreset(filters.from, filters.to, today)` 派生。`FilterBar` 时间字段改为 `role="group"` 内的四个 `data-quick` 按钮（`aria-pressed` 表示选中）+ 常驻 `.date-range` 两个原生日期框，删除时间 `Select` 与 `label[for=filter-preset]`；日期框清空时同步把 DOM 值恢复为当前生效值。`styles.css` 新增 `.quick-button` 与其 `[aria-pressed='true']` 态、`.filter-label`，移除时间下拉专用规则。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/filters.test.ts` 5 项通过。交互层断言留待 T009 的验收脚本与 T010 全量检查。

必要的问题与决策：与 T004 合并为同一提交（理由见 T004）。未做 `min / max` 输入限制：跨度是区间属性而非单日属性，按 Plan 用校验加错误提示表达。

提交：a96b460

# T006 日期轴职责归位

状态：done

目标与完成条件：按 Spec R9 / R10、AC6 / AC8 与 Plan「接口归位」「面板层补轴」删除 `TimeseriesResponse.days`、`getTimeseries` 只返回 `rows`；新增前端 `TrendChartData` 与 `buildTimeseriesAxis`（跨度 ≤ 100 天时逐天补 0），`TrendChart` 的渲染逻辑与 `panel-meta` 文案不变。字段删减必须与所有消费方在同一任务完成，保证 `npm run typecheck` 通过。完成条件含 `/api/timeseries` 响应不含 `days`、选近 7 天时画满 7 格、空 `rows` 走空态。

必要依赖：T001、T005

修改范围：`src/shared/types.ts`、`server/query.ts`、`src/web/display.ts`、`src/web/App.tsx`、`src/web/components/TrendChart.tsx`、`tests/api.test.ts`、`tests/display.test.ts`、`tests/acceptance.test.ts`、`tests/group-normalization.test.ts`

实施结果：`TimeseriesResponse` 去掉 `days`，`getTimeseries()` 删除区间推断与 `enumerateDays` 调用，只返回 `{ rows }`。`display.ts` 新增 `TrendChartData` 与 `buildTimeseriesAxis(from, to, rows)`（缺少端点、`from > to` 或空 `rows` 返回空轴），`TrendChart` 的 data 类型改为 `TrendChartData`、其余渲染逻辑与 `panel-meta` 未改；`App` 用筛选区间与原始 `rows` 组装 `days / rows`，模型 0 值隐藏只作用于 `rows`。同步改写 `tests/api.test.ts` 的时序用例（断言无 `days`、不再补日期）、新增 `tests/display.test.ts` 三项轴用例，并把 `tests/acceptance.test.ts`、`tests/group-normalization.test.ts` 中读取 `days` 的断言改为「响应不含 `days` + rows 日期集合」。

验证：`npm run typecheck` 通过（0 错）；`npm test` 12 个文件、126 项通过（1 项跳过）。

必要的问题与决策：T006 原修改范围漏了 `tests/acceptance.test.ts` 与 `tests/group-normalization.test.ts` 两个 `days` 消费方（`tsconfig.json` 的 `include` 含 `tests`，漏改会直接让 `typecheck` 失败）。按「字段删减与所有消费方同任务完成」的完成条件补入本任务范围，属范围补齐、不改需求与方案。

提交：a6b3d24

# T007 分段纯函数

状态：done

目标与完成条件：按 Spec R5 / R7 与 Plan「分段纯函数下沉」实现按当前主指标的段过滤（值 > 0 且属于可见模型集合）、降序与稳定排序、段宽分摊（各段宽度之和等于原单色条宽）。完成条件含 0 值过滤、行值为 0、负值、无段、宽度和等边界由单测覆盖，且不改变任何聚合值。

必要依赖：T001

修改范围：`src/web/display.ts`、`tests/display.test.ts`

实施结果：`display.ts` 新增 `segmentValue(segment, metric)`、`visibleSegments(row, metric, visibleModels)`（`> 0` 且可见、按数额降序、同值按模型业务键升序，复制数组后再排序）与 `segmentWidths(share, rowValue, segments, metric)`（条宽 `share * 100` 限幅 `[0, 100]`，按段占比分摊，最后一段用差值补齐浮点误差）。函数只做展示派生，不读写聚合值。

验证：`npm run typecheck` 通过（0 错）；`npx vitest run tests/display.test.ts` 27 项通过（新增 `segmentValue` 1 项、`visibleSegments` 4 项、`segmentWidths` 5 项，覆盖 0 值 / 负值 / 不可见段 / 行值为 0 / 无段 / 单段 / 浮点补齐 / 超 100% 限幅）。

提交：1034f13

# T008 分组条分段着色与明细提示

状态：done

目标与完成条件：按 Spec 行为 6–9、R5 / R6 / R8、AC4 / AC5 与 Plan「BreakdownList 分段与明细提示」给两个 tab 的「按分组」列表加按模型色段与整行浮出提示；`groupRows` 请求带 `split=model`，「按对话 / 按模型」保持单色；点击行仍是筛选，固定行高、8 行截断、「N 项」与占比不变。完成条件含段色与趋势图逐值一致、hover 与键盘 focus 都触发、提示内容与数值格式符合 Spec、分组原始路径改由浮层承载。

必要依赖：T003、T006、T007

修改范围：`src/web/components/BreakdownList.tsx`、新增 `src/web/components/BreakdownTooltip.tsx`、`src/web/App.tsx`、`src/web/styles.css`

实施结果：`BreakdownList` 新增可选 `stackByModel` 与 `visibleModels`，仅「按分组」传入；分段时 `.breakdown-bar` 渲染多个 `.breakdown-segment`（`backgroundColor = modelColor(segment.model)`，段间 1px 白线，无 opacity 保证与趋势图逐值一致），无有效段时回退单色条。新增 `BreakdownTooltip`（`role="tooltip"`、`pointer-events: none`）：分组名 + 该行合计 + 原始业务键 + 逐模型「色点 / 展示名 / 数额」按降序，无段显示「无数据」，Token 用 `formatTokens`、积分用 `formatCredit`。行上绑定 `onMouseEnter / onMouseLeave / onFocus / onBlur`，按行在视口的位置决定向上或向下弹出；`stackByModel` 时移除原生 `title`，原始路径改由浮层承载，行高与列表高度计算未改。`App` 的 `groupRows` 请求改为 `dim=group&split=model`，两个 tab 的「按分组」传 `stackByModel` / `visibleModels`。

验证：`npm run typecheck` 通过（0 错）；`npm run build` 通过（仅既有的 chunk 体积提示）。交互断言（hover / focus、段宽之和、浮层内容与定位）由 T009 的验收脚本与 T010 全量检查覆盖。

必要的问题与决策：浮层不引入 portal，`.breakdown-list` 无内部滚动、`.panel` 未设 `overflow`，相对 `li` 定位即可；若验收发现被面板裁剪再评估 portal。

提交：0a802a0

# T009 交互验收脚本适配

状态：done

目标与完成条件：按 Spec AC1–AC9 与 Plan「验收脚本适配」把 `setPreset` 改造为 `clickQuick / setRange / setWideRange`（宽区间起点从 `rows` 取最小 `date`），改写依赖 `#filter-preset` 的下拉与布局断言，补齐时间联动、日期轴归位、跨度上限与分段提示断言；脚本不引入依赖、不改产品代码，`npm run acceptance` 全项通过。同步 `docs/devops.md` 的覆盖范围与取数说明，并写明数据跨度超过 100 天时如何调整验收取数。

必要依赖：T005、T006、T008

修改范围：`scripts/panel-acceptance.mjs`、`docs/devops.md`

实施结果：`setPreset` 拆为 `clickQuick`（点 `[data-quick]`）、`typeDate` / `setRange`（原生 setter + `input` 事件，跨区间时先写不会越界的一端）、`setWideRange`（从 `/api/timeseries` 的 `rows` 取最早 `date` 到今天，跨度超 100 天直接报错）；`readTimeState` / `readGroupTooltip` / `readFirstGroupRow` 补齐状态读取，「空范围」用例改用「最早数据前一天」这一可达区间。原 `#filter-preset` 的四处下拉断言改为三个维度下拉 + 四个快捷按钮布局断言，分组行原始键改从浮层读取。新增 7 项断言：AC1 控件形态与默认区间、AC2 四个按钮回填与查询串一致及反向匹配、AC3 顺序错误与清空回弹、AC8 无 `days` 且近 7 天 7 格、AC9 100 / 101 天前后端一致拦截、AC4 分段段色与段宽、AC5 hover / focus 明细与行高。无头环境开启 `Emulation.setFocusEmulationEnabled`，否则 `focus()` 不触发浮层。`docs/devops.md` 补覆盖范围、`setWideRange` 取数与 100 天调整方式、前后端需同次构建。

验证：`npm run acceptance` 23 项全部通过（原 16 项 + 新增 7 项，另含改写后的既有断言）；过程记录：首次运行 AC4 段宽比对口径与颜色空格归一化、AC5 无头焦点模拟两处脚本问题已修正后复跑通过。

必要的问题与决策：段宽之和的口径按「条容器宽 × 行占比」（即原单色条宽），不是条容器全宽；颜色比对统一经 `normalizeColor()`，避免 `rgb(a, b, c)` 与 `rgb(a,b,c)` 的字符串差异。

提交：dbf8e2b

# T010 文档同步与收尾全量检查

状态：done

目标与完成条件：按 AGENTS.md 第 5 节与 Spec「与既有交付的关系」逐项收尾：更新 `product-brief.md`、`technical-architecture.md`、`docs/model-colors.md`，核对 Spec / Plan / Tasks 与长期文档无矛盾、删除过时说明，检查 `docs/backlog/` 相关条目；按 Spec AC1–AC9 逐条验收；全量执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`；一次性回填 T001–T009 的提交字段。本任务为收尾任务。

必要依赖：T001–T009

修改范围：`docs/`、`docs/delivery/time-range-group-split-tasks.md`

实施结果：`product-brief.md` 交付形态段改为四个快捷区间 + 常驻起止框、默认近 3 天、不提供「本月 / 全部」、单次跨度不超过 100 天，成功标准补「按分组数值条色段」；`technical-architecture.md` 分层原则把连续日期轴与分段颜色 / 段宽列为展示派生、重写筛选栏段落、接口表改为 `/api/timeseries` 只返回 `rows` 与 `/api/breakdown` 的 `split=model` / `models`、补四个读取筛选端点的 400 分支；`model-colors.md` 补分组数值条段色与 1px 白线限制。校正 Spec / Plan 中「五个端点」的表述为「四个读取筛选的端点」（`/api/refresh` 不解析筛选），删除已落定的「待确认问题 / 待确认取舍」与「Plan 待确认」提示，修正 Plan 测试策略里 `tests/shared.test.ts` 的落点描述。`docs/backlog/` 只有 `subagent-credit-reconciliation.md`，与本交付无关，无需改动。已一次性回填 T001–T009 的提交字段（T004 / T005 合并为同一提交 `a96b460`）。

验证：`npm run typecheck` 通过（0 错）；`npm test` 12 个文件、136 项通过（1 项跳过）；`npm run build` 通过（仅既有的 chunk 体积提示）；`npm run acceptance` 23 项全部通过。AC 对照：AC1 / AC2 / AC3 由验收脚本同名断言覆盖（另含 AC12 的时间区布局）；AC4 / AC5 由「分组条按模型分段」「hover 与 focus 浮出明细」两项覆盖；AC6 由 `tests/api.test.ts`、`tests/group-normalization.test.ts`、`tests/acceptance.test.ts` 与既有 AC1 / AC4 / AC7 / AC13 断言覆盖；AC7 即本条全量检查与文档同步；AC8 由「不含 days、近 7 天画满 7 格」覆盖；AC9 由「100 天可用 / 101 天一致拦截」与 API 单测覆盖。
