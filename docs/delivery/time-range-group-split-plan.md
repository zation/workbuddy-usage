# 时间快捷切换与分组条模型分段 Plan

本计划对应 [time-range-group-split-spec.md](./time-range-group-split-spec.md)。已确认决策：**按钮为四个「今天 / 3 天 / 7 天 / 30 天」，保留「今天」**；时间控件为快捷按钮 + 常驻起止框、双向联动；去掉「更多 / 本月 / 全部 / 自定义」；**默认与重置都落在「近 3 天」**；**区间跨度上限 100 天，超限由 API 报 400、前端显示错误，不做降级展示**；分段只作用于「按分组」；提示为整行浮出明细；交叉聚合由服务层提供，不改表与口径；**「一起做」——`/api/timeseries` 去掉 `days`，日期轴归位到面板层**。

## 现状分析

**时间链路**

- `src/web/filters.ts` 的 `PresetKey` 有 6 个值（`today / sevenDays / thirtyDays / month / all / custom`），`PRESETS` 直接作为 `#filter-preset` 下拉的选项；`rangeForPreset(preset, today, custom)` 计算区间，`applyPresetRange()` 只替换 `from / to` 并保留三个维度筛选。
- `src/web/App.tsx` 同时持有 `preset`、`custom`、`filters`、`rangeError` 四份状态：`handlePreset` 写预设并替换区间，`handleCustom` 只在 `preset === 'custom'` 且区间合法时才写 `filters`，`handleReset` 回到 `today` 且把 `custom` 重置为今天。日期框只在 `preset === 'custom'` 时由 `FilterBar` 渲染。
- `src/web/components/FilterBar.tsx` 的时间字段是 `Select`（`id="filter-preset"`）+ 条件渲染的 `.date-range` 两个 `input[type=date]`；`label[for=filter-preset]`、`.filter-time` / `.filter-time-controls` / `.select-compact` 样式都围绕下拉写。`.filter-error` 已存在，用于显示 `rangeError`。
- `server/app.ts` 的 `readFilters()` 被四个读取筛选的端点共用（`/api/refresh` 不解析筛选），目前只校验 `from / to` 的格式与 `from > to`，返回 `{ ok: false, error }` 后由各端点转成 400。
- `tests/filters.test.ts` 固化了 `month / all / custom` 三个分支与 `sevenDays` 的区间；改造后这些用例必须一起改。
- `scripts/panel-acceptance.mjs` 对旧控件耦合较重：`setPreset()` 通过 `#filter-preset` 下拉选值，至少 10 处调用 `setPreset('all')` / `'today'` / `'custom'`；`#filter-preset` 还出现在「四个下拉」断言（约 637 行）与「预设下拉紧凑宽度 + 自定义日期框数为 2」的布局断言（约 717–740 行）。移除「全部 / 自定义」后，这些取全量数据的路径需要替代方案。

**趋势图日期轴的职责**

- `server/query.ts` 的 `getTimeseries()` 除了 `GROUP BY r.date_key, m.id` 聚合出 `rows`，还单独算 `start = filters.from ?? dates[0]`、`end = filters.to ?? dates.at(-1)`，再调 `enumerateDays(start, end)` 生成 `days`，返回 `{ days, rows }`。
- `src/web/App.tsx` 的 `visibleTimeseries` 把 `days` 原样透传、只按当前 tab 过滤 `rows`；`TrendChart` 用 `data.days` 做 `xAxis.data`，并按 `days.map(day => values.get(day) ?? 0)` 给每个 series 取值。
- 这段 `days` 是**展示形状**，不参与任何聚合、不影响合计：`rows` 里没有的日期在轴上补 0。它放在服务层是历史顺手 —— 旧「全部」预设不传 `from / to`，服务层需要替前端推断数据边界，既然算出了 `start / end` 就顺手把轴也生成了。按 `technical-architecture.md` 的「口径只在解析层与服务层、面板层只渲染返回值」，这属于面板职责。
- 更实际的问题是：轴与数据是两个独立数组，`days` 被截断时前端只能被动接收，`rows` 里的真实数值对不上轴位，静默全补 0（卡片与拆分列表都正常、只有趋势图空）。改造后日期框常驻、前端**始终知道 `from / to`**，服务层推断边界的理由消失，正是把轴挪回前端的时机。`enumerateDays` 在 `src/shared/dates.ts`，前后端共用，挪动调用位置不产生第二份实现。

**长区间与跨度上限**

- `enumerateDays(from, to)` 有固定 `guard < 3700`（约 10.1 年）循环上限。旧「全部」不传 `from / to`、`start` 取数据最早日期，不会触发；移除「全部」后用户或验收脚本手选很早的起始日期时，`days` 会被截断到前 3700 天（如 2000-01-01 起只到 2010-02-16），2026 年的 `rows` 全部落在轴外。
- 开发者确认改用**输入约束**解决：区间跨度上限 100 天（含首尾），超限直接报错，不做降级展示。这样前端补轴最多产出 100 项，3700 guard 永远不可达，**`enumerateDays` 本身与其 guard 不改**；也不再需要「按周 / 月聚合」「只显示有数据日期 + 提示」这类展示层降级。
- 实测派生库（只读查询 `.data/index.db`）：最早 `2026-09-28`、最晚 `2026-11-13`，含首尾 47 天、其中 33 天有数据。远小于 100 天，因此验收脚本用「数据最早日期 → 今天」的宽区间仍能一次覆盖全量，无需拆分请求。若将来数据跨度超过 100 天，需要全量的断言改为直接读不带日期参数的 API（见风险 1）。

**拆分链路**

- `server/query.ts` 的 `getBreakdown()` 只做单维度聚合：`GROUP BY ${columns.groupBy}`，group 维度用 `GROUP_KEY`（CASE 表达式，自动目录归并「默认」），`BreakdownRow` 没有按模型拆分的数据。`src/shared/types.ts` 的 `BreakdownRow` 是扁平汇总行。
- `src/web/components/BreakdownList.tsx` 三个维度共用：按当前 metric 排序、截前 8 行，条宽 `Math.min(100, share * 100)%`，单色 `.breakdown-fill { background: var(--accent) }`；每行是 `<button title={row.key}>`。
- 颜色由 `src/web/model-colors.ts` 的 `modelColor(modelKey)` 提供，趋势图系列、`ModelDot`、请求明细色点已逐值一致（`docs/model-colors.md`）。`TrendChart` 的 tooltip 是 ECharts HTML formatter（过滤 `> 0`、按值降序、`escapeHtml`），与 DOM 列表不共用。
- `EChart.tsx` 是 canvas 图表实例，其 tooltip 无法直接复用到 DOM 行；拆分列表需要自己的浮层。
- 派生库 `requests` 已有 `group_id / model_id / total_tokens / credit / date_key`（`src/etl/index-db.ts`，`SCHEMA_VERSION = 3`），交叉聚合不需要改表。实测规模 11 模型 × 66 分组、471 请求，结果集很小。

## 技术方案与关键取舍

### 1. 时间纯函数：单一状态 + 反向匹配

`src/web/filters.ts` 收敛为：

- `PresetKey = 'today' | 'threeDays' | 'sevenDays' | 'thirtyDays'`；`QUICK_PRESETS` 提供四个 `{ key, label }` 供按钮渲染（不再作为 `Select` 选项）；导出 `DEFAULT_PRESET = 'threeDays'`。
- `rangeForPreset(preset, today)` 去掉 `custom` 参数与 `month / all / custom` 分支；区间为 `[today, today]`、`[addDays(today,-2), today]`、`[addDays(today,-6), today]`、`[addDays(today,-29), today]`。
- 新增 `matchPreset(from: string, to: string, today: string): PresetKey | null`：把当前区间与四个预设区间做字符串精确比对，命中则返回该 key，否则 `null`。日期键是定长 `YYYY-MM-DD`，字典序即时间序，无需解析。
- `applyPresetRange()`、`hasActiveFilters()`、`todayKey()` 保持。

**取舍**

- **不再保留 `preset` / `custom` 两份状态**：`filters.from / to` 是唯一真相，日期框 value 与按钮高亮都由它派生，双向联动天然一致，也不存在「预设与日期不同步」的中间态。
- **按钮确认为四个**，保留「今天」并新增「3 天」：默认改成 3 天后若没有对应按钮，首屏四个按钮会全灭、看起来像自定义区间；删掉「今天」则是用户没要求的删减。四档都不超过 100 天上限。
- **反向匹配用精确比对**，不做「按跨度天数猜预设」：`[today-2, today]` 与 `[yesterday-2, yesterday]` 跨度相同但语义不同，按天数猜会误高亮。

### 2. App 与 FilterBar：常驻日期框

`src/web/App.tsx`：

- 删除 `preset` / `custom` state，保留 `rangeError`；`filters` 初始为 `rangeForPreset(DEFAULT_PRESET, today)`。
- `handleQuick(key)` → `setFilters(prev => applyPresetRange(rangeForPreset(key, today), prev))`，清 `rangeError`。
- `handleRange(from, to)`：任一为空 → 不更新 `filters`（受控值回弹）；`from > to` → `setRangeError('起始日期不能晚于结束日期')`、不更新；跨度超限（见第 4 节）→ `setRangeError('时间跨度不能超过 100 天')`、不更新；否则清错误并 `setFilters(prev => ({ ...prev, from, to }))`。
- `handleReset()` → `setFilters(rangeForPreset(DEFAULT_PRESET, today))` 并清错误。
- `activePreset = matchPreset(filters.from ?? '', filters.to ?? '', today)` 传给 `FilterBar`。

`src/web/components/FilterBar.tsx`：

- props 用 `activePreset` / `onQuick` / `onRange` 替换 `preset` / `custom` / `onPreset` / `onCustom`；`filters` 仍是日期框的取值来源。
- 时间字段 DOM：`[role="group" aria-label="时间范围"]` 内四个 `<button type="button" data-quick={key} aria-pressed={...}>` + 常驻 `.date-range` 两个 `input[type=date]`（`aria-label="起始日期" / "结束日期"`）。`label[for]` 改为普通字段标签，不再指向已不存在的 `#filter-preset`。
- 「重置」的 `isDefault` 改为 `activePreset === DEFAULT_PRESET && !hasActiveFilters(filters)`；`.filter-error` 沿用，现在承载两类错误（顺序颠倒、跨度超限）。
- 分组 / 对话 / 模型三个 `Select` 与 `ModelDot` 完全不动。

**取舍**

- 原生 `input[type=date]`：项目不引入依赖，现有样式与键盘行为可沿用（Spec 非目标已排除日历组件）。不设 `min / max`：跨度是区间属性，不是单日属性，用校验而非输入限制表达更准确。
- 空值回弹用「不 setState」实现，不加回退 state：受控 value 来自 `filters`，React 下一次渲染即恢复原值。
- 不用 `onBlur` 或「应用」按钮：Spec 要求即时生效；非法态只显示错误、保留上一次有效区间。
- 快捷按钮用 `aria-pressed` 而非 `role="tab"`：它们改的是筛选条件、不是切换面板，避免与下方 ModuleTabs 的 tab 语义混淆。

### 3. 接口归位：`/api/timeseries` 只返回 rows

`src/shared/types.ts`：`TimeseriesResponse` 去掉 `days: string[]`，只保留 `rows: TimeseriesRow[]`。

`server/query.ts` 的 `getTimeseries()`：

- 删除 `enumerateDays` 的 import 与 `start / end / days` 那段计算（约 12 行）；`mapped` 之后的返回改为 `return { rows: mapped }`。聚合 SQL、`mapped` 字段映射、按 `r.date_key / m.id` 排序全部不动。
- 不再从 `rows` 推断数据最早 / 最晚日期。

前端接线：

- 定义前端内部类型 `TrendChartData = { days: string[]; rows: TimeseriesRow[] }`，放在 `src/web/display.ts` 或 `TrendChart.tsx` 导出。
- `TrendChart` 的 `data` prop 由 `TimeseriesResponse | null` 改为 `TrendChartData | null`；组件内部 `data.days` / `data.rows` 的读法、`days.map(day => values.get(day) ?? 0)` 的 series 构建、`tooltip` / `legend` / 轴配置、`panel-meta` 文案**全部不改**。
- `App.tsx` 的 `visibleTimeseries` 改为组装 `{ days, rows }`：`days` 来自第 4 节的纯函数，`rows` 仍按 `visibleModels` 过滤（模型集合未返回时先不过滤，避免首屏闪空）。

**取舍**

- **直接删字段，不留兼容层**：本地单体、前后端同仓同次构建，没有外部消费者；保留 `days` 会造成「服务层一份轴、前端一份轴」两套并存，正是本次要消除的问题。这是本交付唯一的响应字段删减，其余四个端点不动。
- **`TrendChart` 完全不改渲染逻辑**：把「轴的来源」与「轴的用法」解耦 —— 数据形状不变、只是由 App 组装，回归面最小。
- 服务层不再推断边界：改造后 `from / to` 始终有值，推断逻辑失去意义；`rows` 为空时前端走空态。

### 4. 跨度校验与面板层补轴

**共享规则（单一实现）**

- `src/shared/constants.ts` 新增 `export const MAX_RANGE_DAYS = 100;`
- `src/shared/dates.ts` 新增纯函数（用 UTC 解析日期键，避免本地时区与夏令时影响；`enumerateDays` 本身不动）：

```ts
export function daySpan(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}
```

跨度按**含首尾**计算，合法条件 `daySpan(from, to) <= MAX_RANGE_DAYS`，即 `to - from ≤ 99` 天差。

**前端即时拦截**：`App.handleRange` 在写入 `filters` 前判断，超限时只设 `rangeError`、不写状态。理由：一次日期改动会触发 8 个以上 `useQuery` 并发请求，若完全交给 API 兜底，会出现 8 个 400、指标卡变 `—`、每个面板各弹一条错误；前端拦截让错误只出现在筛选栏 `.filter-error`，且不产生无效请求。规则本身来自 `src/shared/`，两端共用一份实现，不构成两套口径。

**API 契约兜底**：`server/app.ts` 的 `readFilters()` 在 `from` 与 `to` 都存在时追加校验，超限返回 `{ ok: false, error: '时间跨度不能超过 100 天' }`，各端点沿用现有 `c.json({ error }, 400)` 路径。四个筛选端点因此一致。缺失任一日期时**不校验跨度并放行**，保留 API 不带日期取全量的能力（验收脚本与后续工具用），前端日期框不会出现该状态。

**面板补轴**：`src/web/display.ts` 新增纯函数

```ts
export function buildTimeseriesAxis(
  from: string | undefined,
  to: string | undefined,
  rows: TimeseriesRow[],
): string[] {
  if (!from || !to || from > to || rows.length === 0) return [];
  return enumerateDays(from, to);
}
```

`App` 用 `filters.from / to` 与 `timeseries.data.rows` 计算轴；跨度已由校验保证 ≤ 100，`enumerateDays` 最多产出 100 项。`from > to` 或空 `rows` 沿用错误态 / 空态，不画空图。

**取舍**

- **输入约束取代降级策略**：不再有 `truncated` 标志、`maxDays` 阈值、「只显示有数据日期」分支与 `panel-meta` 降级提示；`TrendChartData` 只需 `{ days, rows }`，`TrendChart` 的 `panel-meta` 保持原文案。
- **不改 `enumerateDays` 的 3700 guard**：100 ≪ 3700，上限不可达；给它打补丁反而会把「输入约束」这件事散到两处。`src/shared/dates.ts` 只新增 `daySpan()`。
- **不引入按周 / 月聚合**：`product-brief.md` 明确「时间粒度只有天」，改粒度属业务口径变更；超限直接报错比悄悄改粒度更可解释。
- **两端都校验**，规则单一实现、文案一致：前端负责即时反馈与避免无效请求，API 负责契约与防绕过。若开发者希望完全由 API 兜底，见「待确认取舍」。
- 轴是纯展示派生，不参与任何聚合；`enumerateDays` 仍是前后端共享函数，没有重复实现。

### 5. 服务层：附加交叉聚合

`src/shared/types.ts`：

```ts
export interface BreakdownSegment {
  model: string;
  modelName: string;
  totalTokens: number;
  credit: number;
}

// BreakdownRow 增加可选字段
models?: BreakdownSegment[];
```

`server/app.ts`：`/api/breakdown` 读取可选 `split` 查询参数，只接受 `model`（其它值返回 400）；仅 `dim=group` 时生效，其它维度忽略该参数（保持幂等、不因多余参数报错）。

`server/query.ts`：`getBreakdown(db, filters, dimension, withModelSplit = false)`。**原聚合 SQL 一行不改**；`withModelSplit` 时用同一个 `where` / `params` 追加第二条查询：

```sql
SELECT ${GROUP_KEY} AS group_key,
       COALESCE(m.model, '未知模型') AS model,
       COALESCE(m.display_name, m.model, '未知模型') AS model_name,
       SUM(r.total_tokens) AS total_tokens,
       SUM(r.credit) AS credit
${BASE_FROM} ${where}
GROUP BY ${GROUP_KEY}, m.id
ORDER BY group_key ASC, total_tokens DESC, model ASC
```

按 `group_key` 归并挂到对应 `BreakdownRow.models`，无分段的行给 `[]`；两条 SQL 共用 `BASE_FROM`、`where`、`params` 与 `GROUP_KEY` 常量。`tokenShare` / `creditShare` 仍按汇总行算。

前端 `App.tsx` 的 `groupRows` 请求改为 `/api/breakdown?dim=group&split=model&${query}`；`groupOptions`（下拉）、`sessionRows`、`modelRows` 不带 `split`，响应体积不变。

**取舍**

- **两条 SQL，而不是改写原 SQL 加窗口函数**：把 `GROUP BY GROUP_KEY` 改成 `GROUP BY GROUP_KEY, m.id` 会让汇总行变成多段，需再套一层 `SUM OVER` 或二次聚合，回归风险高；两条 SQL 让原有聚合路径零改动。
- **附加可选字段，而不是新端点**：架构文档明确端点数量固定；前端只对 `groupRows` 这一个请求多带参数，无额外网络往返。
- **分组键复用 `GROUP_KEY` 常量**：自动目录归并「默认」的规则只在解析 / 服务层一处；若第二条 SQL 另写 CASE，虚拟分组的分段会与汇总行错位。
- **模型展示名取 `m.display_name`**：维表已含 C12 规范化与重名后缀，不需要在服务层重算；`m.id` 分组、业务键 `m.model` 输出，内部 `id` 不外露（C14）。
- **颜色不下发**：仍由面板按 `model` 业务键查 `modelColor()`，坚持既定分层。
- 不改 `SCHEMA_VERSION`、不改表、不动 ETL 与刷新流程。

### 6. 分段纯函数下沉

`src/web/display.ts` 新增：

- `segmentValue(seg, metric)`：取 `totalTokens` 或 `credit`。
- `visibleSegments(row, metric, visibleModels)`：过滤 `value > 0 && visibleModels.has(seg.model)`，按值降序、同值按 `model` 字典序稳定排序。
- `segmentWidths(share, rowValue, segments, metric)`：每段 `share * (segValue / rowValue) * 100`，行值 ≤ 0 返回空数组；最后一段用「总宽 − 前面各段之和」补齐浮点误差，保证段宽之和精确等于原单色条宽；单段宽度 clamp 到 `[0, 100]`。

**取舍**

- `visibleModels` 仍取「不含模型筛选」的 `modelOptions` 判定集合（Spec R5），与分段数据互不混用：选中某模型后分段数据本身已被 `WHERE m.model = ?` 收敛，条自然呈单色。
- 用 `> 0` 而非 `!== 0`：与趋势图 tooltip 一致；负值段会破坏段宽语义，现有 token / credit 数据非负，负值不渲染并在单测里固化。
- 0 值隐藏掉的段贡献为 0，因此条总长不变，与 Spec AC4 / AC6 一致。

### 7. BreakdownList 分段与明细提示

- `BreakdownList` 增加可选 prop `stackByModel?: boolean`；只有两个 tab 的「按分组」传 `true`，「按对话」「按模型」不传，继续渲染单色 `.breakdown-fill`。显式开关避免以后别的维度带上 `models` 时被误渲染。
- 分段时 `.breakdown-bar` 内渲染多个 `.breakdown-segment`，`backgroundColor = modelColor(seg.model)`，段间 `border-right: 1px solid #fff`（最后一段不加），与趋势图堆叠块的白色描边一致。
- 新增 `src/web/components/BreakdownTooltip.tsx`：`role="tooltip"`、`pointerEvents: 'none'`，由 `BreakdownList` 内的 `activeKey` state 控制，行上绑定 `onMouseEnter / onMouseLeave / onFocus / onBlur`。内容为分组展示名 + 原始业务键（小字，替代原 `title={row.key}`）、该行主指标合计、各有效段「色点 + modelName + 数额」按降序；无有效段显示「无数据」。Token 用 `formatTokens`，积分用 `formatCredit`。
- 定位：`li { position: relative }`，浮层相对行绝对定位，默认向上弹出、靠近顶部时向下，配合 `max-width` 与 `z-index` 限制在可视区域内；`.breakdown-row` 固定 52px 行高、`.breakdown-list` 的 `--rows` 高度计算都不变。
- 移除 `.breakdown-row` 的 `title={row.key}`，避免原生 title 与自定义浮层叠加；分组原始路径改由浮层承载。

**取舍**

- **自定义 DOM 浮层，不复用 ECharts tooltip**：`EChart` 是 canvas 实例，拆分列表是 DOM 行；只对齐「色点 + 名称 + 数值、降序、隐藏 0 值」的信息结构，不引入第二个 ECharts 实例。
- **内容用 React 文本节点渲染**：自动转义，不需要 `TrendChart` 里服务于 HTML formatter 的 `escapeHtml`；分组路径与模型名可能含特殊字符。
- **不引入 portal**：`.breakdown-list` 已无 `overflow: auto`，相对 `li` 定位可行；若实测被面板裁剪再评估，避免本交付引入额外复杂度。
- 浮层状态只在 `BreakdownList` 内，两个 tab 各渲染各的组件实例，切换不串状态。

### 8. 验收脚本适配

`scripts/panel-acceptance.mjs` 是本交付改动面最大的测试文件：

- `setPreset()` 拆成 `clickQuick(evaluate, key)`（点 `[data-quick="..."]`）与 `setRange(evaluate, from, to)`（用 native setter 改 `.date-range input[type=date]` 的 value 并派发事件，等 React 重渲染）。
- **替代 `setPreset('all')`**：新增 `setWideRange(evaluate)`，起始取 `GET /api/timeseries`（不带日期参数）返回的 **`rows` 里最小 `date`**（`days` 已不存在）、结束取今天，并加断言确认该区间下 `/api/breakdown?dim=group` 行数与不带日期参数时一致。实测数据含首尾 47 天，仍是合法区间；不用固定早日期。
- `#filter-preset` 的四个下拉断言改为「三个 `Select` + 一组快捷按钮」；布局断言改为「快捷按钮 4 个、常驻日期框 2 个、`.filter-time` 内无 `.select`」。
- 新增断言：默认 / 重置为 3 天且 `aria-pressed` 正确；四个按钮回填区间与 `/api/summary` 查询串一致；手动改日期的反向匹配（命中与全灭）；起始晚于结束显示错误且查询串不变；清空日期框回弹。
- 新增断言：`/api/timeseries` 响应不含 `days`；选近 7 天时 x 轴类目数为 7（即使中间无数据）；选 100 天区间生效、趋势图 100 个类目；改成 101 天时筛选栏显示「时间跨度不能超过 100 天」、页面查询串与视图保持上一次有效状态、不出现成功的 `/api/summary` 请求；直接 `fetch` 跨度 > 100 的接口返回 400 且错误文案一致；不传日期参数的请求仍返回全量；改回合法区间后错误清除。
- 新增断言：两个 tab 的「按分组」段数 > 0、段色与趋势图系列色逐值一致、段宽之和 ≈ 原条宽、hover 与 focus 浮层内容与降序、0 值模型不出现在段与提示；「按对话 / 按模型」仍为单色。
- `readChart()` 从页面已加载的 ECharts 实例读 y 轴 formatter、tooltip formatter 与 series 颜色，不直接读 API 的 `days`，无需改动。
- 脚本不引入依赖、不改产品代码；`docs/devops.md` 同步覆盖范围、`setWideRange` 的取法与跨度上限。

## 影响范围

| 类别 | 文件 |
| --- | --- |
| 交付文档 | `docs/delivery/time-range-group-split-{spec,plan,tasks}.md` |
| 类型契约 | `src/shared/types.ts`（`TimeseriesResponse` 去 `days`、`BreakdownSegment`、`BreakdownRow.models`）、`src/shared/constants.ts`（`MAX_RANGE_DAYS`）、`src/shared/dates.ts`（新增 `daySpan`，`enumerateDays` 不动） |
| 服务层 | `server/query.ts`（`getTimeseries` 去轴、`getBreakdown` 加交叉查询）、`server/app.ts`（`split` 参数、`readFilters` 跨度校验） |
| 时间链路 | `src/web/filters.ts`、`src/web/App.tsx`、`src/web/components/FilterBar.tsx` |
| 日期轴 | `src/web/display.ts`（`buildTimeseriesAxis`）、`src/web/App.tsx`、`src/web/components/TrendChart.tsx`（仅 data 类型） |
| 分段与提示 | `src/web/display.ts`、`src/web/components/BreakdownList.tsx`、新增 `src/web/components/BreakdownTooltip.tsx` |
| 样式 | `src/web/styles.css`（快捷按钮、`.breakdown-segment`、浮层；移除时间下拉相关规则） |
| 单测 | `tests/filters.test.ts`、`tests/display.test.ts`、`tests/api.test.ts`、`tests/shared.test.ts` |
| 交互验收 | `scripts/panel-acceptance.mjs`、`docs/devops.md` |
| 长期文档 | `docs/product-brief.md`、`docs/technical-architecture.md`、`docs/model-colors.md` |

`src/etl/`、`server/index.ts`、`vite.config.ts`、`package.json`（无新依赖、无新脚本）不改；`data-model.md` 与 `integration.md` 不涉及。

## 数据与接口变化

- `GET /api/timeseries` **去掉 `days`**，只返回 `rows`。这是本交付唯一的响应字段删减，属收缩契约。
- 四个筛选端点的 `readFilters` 新增校验：`from` 与 `to` 都存在且含首尾跨度 > 100 天时返回 `400 { error: '时间跨度不能超过 100 天' }`；缺失任一日期时不校验并放行。其余响应语义不变。
- `GET /api/breakdown` 新增可选参数 `split=model`，仅 `dim=group` 生效；响应 `rows[].models` 为可选附加字段（`BreakdownSegment[]`）。其余两个维度、不带 `split` 的响应结构不变。
- `Filters` 结构不变；`PresetKey` 删除 `month / all / custom`，新增 `threeDays`。
- **无数据库迁移**：表结构、派生规则、`SCHEMA_VERSION = 3` 都不变，不需要删库重建；静态资源随构建重新生成。
- **兼容性**：`/api/breakdown` 的附加字段向后兼容（旧前端忽略、新前端在 `models` 缺失时回退单色条）；`/api/timeseries` 是破坏性变更，但前后端同仓同次构建、无外部消费者，不提供兼容层。旧前端配新后端会拿到没有 `days` 的响应，只可能出现在开发期前后端版本错配，重启 `npm run dev` 或重新 `npm run build` 即可。

## 顺序约束

1. 类型契约 + 共享规则（`TimeseriesResponse` 去 `days`、`MAX_RANGE_DAYS` / `daySpan`、`BreakdownSegment`）与 API 单测；同时完成 `readFilters` 跨度校验、`getTimeseries` 去轴、`getBreakdown` 加交叉聚合。
2. 时间纯函数 + 单测（依赖 1 的共享规则）。
3. App 状态与 FilterBar 时间控件（依赖 2；含前端拦截与 `.filter-error`）。
4. 面板补轴纯函数 + `TrendChart` / `App` 接线（依赖 1、3）。
5. 分段纯函数 + `BreakdownList` + tooltip（依赖 1）。
6. 验收脚本适配与新增断言（依赖 3、4、5）。
7. 文档同步与全量检查（最后）。

约束理由：1 先于 2 / 4 / 5 是为了让新契约与共享规则在前端落地前已通过服务端断言，避免前后端用两套字段或两套跨度口径；3 先于 4 是因为 `buildTimeseriesAxis` 依赖「`from / to` 始终有值且合法」这个新状态模型；6 的脚本选择器与断言依赖全部新 DOM；7 的文档必须以实际实现为准。每个任务完成后单独跑 `npm run typecheck`，不把类型错误留到收尾。

## 测试策略

- **`tests/shared.test.ts`**：`daySpan` 的含首尾计数、跨月 / 跨年、同日为 1、UTC 不受本地时区影响、与 `MAX_RANGE_DAYS` 的 100 / 101 边界；`enumerateDays` 原用例保持不动；`BreakdownRow` 字面量按需补 `models`。
- **`tests/filters.test.ts`**：四个预设区间（含 3 天）、`DEFAULT_PRESET`、`matchPreset` 命中 / 未命中 / 端点边界、`applyPresetRange` 保留三个维度筛选；删除 `month / all / custom` 用例。
- **`tests/display.test.ts`**：`buildTimeseriesAxis` 的含首尾连续补 0、`from > to`、空 `rows`、100 天边界（最多 100 项）；`visibleSegments` 的 0 值过滤、降序与同值稳定、无段；`segmentWidths` 之和等于原条宽、行值为 0、负值、单段、clamp。
- **`tests/api.test.ts`**：四个筛选端点在 `from / to` 跨度 100 天时返回 200、101 天时返回 400 且错误文案一致；只传一个日期或都不传时放行；`/api/timeseries` 响应不含 `days`；`split=model` 时每段之和等于对应行 `totalTokens` / `credit`、`dim != group` 与不带 `split` 时无 `models`、带 `model` 筛选时段收敛、非法 `split` 返回 400、C14 覆盖新字段。原有「补齐日期」用例按新契约改写。
- **交互验收**：`npm run acceptance` 按第 8 节补断言；手工核对段色与趋势图逐值一致、段宽之和、hover / focus 浮层位置与内容、四个按钮与日期联动、重置、近 7 天补满 7 格、101 天错误提示与恢复；DOM 度量确认行高仍为 52px 且列表无内部滚动。
- **全量检查**：`npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`。项目无 lint 脚本（见 `devops.md`）。

## 风险与回滚

1. **100 天限制与验收脚本的全量断言**：实测数据含首尾仅 47 天，`setWideRange`（数据最早日期 → 今天）仍是合法区间，现有全量断言不受影响。若将来数据跨度超过 100 天，依赖「页面处于全量状态」的断言要改为直接读不带日期参数的 API；在 `devops.md` 记下这一点。
2. **两端校验一致性**：前端与 API 都判断跨度，若某侧漏改会出现「前端放行但 API 400」或反之。规则（常量 + `daySpan`）只有一份实现在 `src/shared/`，两端只做比较与文案；单测覆盖 100 / 101 边界，验收脚本同时验证 UI 与直接调 API 两种入口。
3. **破坏性契约变更**：`/api/timeseries` 去掉 `days`。前后端必须同次构建；本地单体无外部消费者，风险可控，但开发期若 API 与 Vite 版本错配会出现趋势图空白，重启开发服务即可，写进 `devops.md`。
4. **验收脚本改造面大**：至少 10 处 `setPreset('all')`、4 个下拉断言与 1 个布局断言依赖旧 DOM，且 `setWideRange` 的取数来源从 `days[0]` 改为 `rows` 最小 `date`。用统一 helper 替代并加行数与接口一致性断言，避免静默少算。
5. **两条 SQL 分组键不一致**：若第二条查询另写 CASE，「默认」虚拟分组的分段会与汇总行错位。共用 `GROUP_KEY` 常量，并用「每行段之和 = 行值」单测兜住。
6. **口径集合混用**：0 值隐藏判定集来自不含模型筛选的 `modelOptions`，分段数据带模型筛选；两者不同但不应互相覆盖。单测覆盖「选中模型 + 某模型在当前 tab 为 0」两组输入；日期轴用 `from / to` 与原始 `rows` 计算，避免隐藏改变类目。
7. **浮层遮挡 / 闪烁 / 撑高行**：用 `pointer-events: none`、相对 `li` 定位、不新增行内高度；DOM 度量与 hover / focus 验收覆盖。若被面板裁剪，再评估 portal，不在本交付预先引入。
8. **受控日期框清空回弹**：空值分支不 setState 时 React 可能不触发重渲染；用验收脚本实际清空并断言 value 恢复，必要时显式 `event.target.value = filters.from`。
9. **跨零点**：`todayKey()` 页面加载时取一次，长时间开页面后「3 天」仍按加载当天算；沿用既有行为，记为已知限制，不在本交付引入定时器。
10. **响应体积**：新增 `models` 后 group 响应最多数百组合，实测数据量可忽略；`days` 移除反而让 timeseries 响应变小。
11. **回滚**：无数据迁移、无索引重建。按 commit 原子回退即可；需注意 `/api/timeseries` 的 `days` 字段与前端补轴是配套的，回退时前后端必须一起回退，不能只回退一侧。跨度校验是新增 400 分支，回退后前端也不再拦截，行为自然恢复。

## 文档同步

- `product-brief.md`：范围段把「默认展示今天」改为「默认近 3 天，四个快捷区间 + 起止日期框，不提供本月 / 全部」，补「单次区间跨度不超过 100 天」；「图表堆叠只按模型着色」补「按分组数值条也按模型分段着色」。
- `technical-architecture.md`：模块划分的面板层描述、筛选栏段落（时间不再是下拉、日期常驻、按钮与日期双向联动）、**接口表 `/api/timeseries` 改为只返回 `rows`、`/api/breakdown` 补 `split=model` 与分段返回值、补四个读取筛选的端点共用的跨度上限 400 分支**、分层原则补「连续日期轴与分段颜色 / 段宽同属展示派生，由面板层生成」；删除与 `days` 相关的旧表述。
- `docs/model-colors.md`：色标覆盖视图增加「按分组数值条色段」，已知限制补「色段靠 1px 白色分隔」。
- `docs/devops.md`：交互验收覆盖范围补时间联动、日期轴归位、跨度上限与分段提示断言；说明 `setWideRange` 从 `rows` 取最早日期、数据跨度超过 100 天时如何调整、以及前后端需同次构建的原因。
- `data-model.md` / `integration.md`：不改（表结构与外部数据均未变化）。
