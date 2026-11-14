# 分组口径归一化 Plan

本计划对应 [group-normalization-spec.md](./group-normalization-spec.md)（含 2026-11-13 确认的增补需求）。已确认决策：tooltip 过滤 0 值对 Token / 积分两张图同时生效；四个下拉（时间 / 分组 / 对话 / 模型）全部统一；「默认」仅在有对应请求时出现；手动分组展示名撞「默认」不做去重或回退；`is_auto` 在插入时确定，规则变更靠版本重建。

## 现状分析

**分组维度**

- `groups` 只有 `id` / `group_path` / `display_name`，没有区分自动目录的字段（`src/etl/index-db.ts` 的 `SCHEMA_SQL`，当前 `SCHEMA_VERSION = 2`）。
- `DimensionWriter.ensureGroup`（`src/etl/dimensions.ts`）按 `group_path` 插入，冲突时 `DO NOTHING`；`groupIds` 缓存只在一次刷新内有效（`src/etl/refresh.ts` 每次刷新新建 `DimensionWriter`）。
- `group_path` 就是 `sessions.cwd` 原值（`src/etl/parse.ts` 的 `groupPath: session?.cwd ?? null`），带 UNIQUE 约束，因此任何由它纯函数计算的值在同一业务键上恒定。
- 服务层分组维度在 `dimensionColumns('group')`（`server/query.ts`）返回 `COALESCE(g.group_path, '未知分组')` 等三个表达式，`GROUP BY g.id` 保证每个原始路径一行；`buildWhere` 用 `g.group_path = ?`；`getRequests` 的展示名是 `COALESCE(g.display_name, g.group_path, '未知分组')`。三处都只认原始路径，因此 71 个日期目录会原样出现。
- `readFilters`（`server/app.ts`）对 `group` 只做 `trim()`，无白名单或路径校验，虚拟业务键可原样透传；`/api/summary`、`/api/timeseries`、`/api/breakdown`、`/api/requests` 四个端点共用 `buildWhere`。
- 分组筛选下拉的选项来自 `App` 的 `groupOptions`（`/api/breakdown?dim=group`，去掉 group 筛选但保留时间 / 对话 / 模型筛选），只由服务层聚合结果驱动，`FilterBar` 不参与口径；因此「默认」只在当前筛选范围内有自动分组请求时出现。
- `RequestTable` 的分组列用 `title={row.group}` 做 hover、`row.groupName` 做文本，改造后 hover 仍显示日期路径。

**面板控件**

- `FilterBar`（`src/web/components/FilterBar.tsx`）的时间预设、分组、对话仍是原生 `select`，模型是 `ModelSelect` 的自定义 combobox（button + listbox，含键盘、ARIA、点击外部关闭、当前值兜底）。两套外观与交互并存，`.filter-field select` 与 `.model-select-*` 各写一份样式（`src/web/styles.css`）。
- 验收脚本依赖原生 select 的读写方式：`setPreset` 直接改 `#filter-preset` 的 `value` 并派发 `change`，AC1 第二轮直接改 `#filter-group`；模型下拉按 `.model-select-option` 与 `data-model` 读取（`scripts/panel-acceptance.mjs`）。
- 现有 `ModelSelect.handleKeyDown` 只处理 ↑↓ / Enter / Space / Esc，不处理 Tab；触发按钮在空值时不渲染图标，选项在空值时渲染空环。

**趋势图提示**

- `TrendChart`（`src/web/components/TrendChart.tsx`）为每个模型建 series，`data` 按 `days` 补 0；tooltip 只配了 `valueFormatter`（`formatTokens` / `formatCredit`），axis 触发时默认列出当天全部系列，包括 0 值模型。两张图共用该组件。
- 验收脚本 `chartStateExpr` 目前只读取 `option.tooltip[0].valueFormatter` 与 y 轴 formatter、series 配色。

## 技术方案与关键取舍

### 1. 判定：解析层纯函数

`src/etl/dimensions.ts` 新增 `isAutoGroupPath(value: string): boolean`，紧邻 `lastPathSegment`：

```ts
const AUTO_GROUP_DIR = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;

export function isAutoGroupPath(value: string): boolean {
  const segments = value.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return false;
  }
  const last = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2] ?? '';
  return AUTO_GROUP_DIR.test(last) && parent.toLowerCase() === 'workbuddy';
}
```

**取舍**

- 不用 `node:path`：`path` 的分隔符随运行平台变化，而 `cwd` 可能来自另一平台（macOS 备份、Windows 迁移）；固定正则同时接受 `/` 与 `\`，与 `lastPathSegment` 的分隔符语义一致。
- 只做形态匹配，不校验日期是否合法（如 `2026-13-40-...`）：本规则识别的是 WorkBuddy 自动目录的命名形态，校验日期只会增加漏判，不会提高准确性。
- `is_auto = 1` 只表示 `cwd` 是 WorkBuddy 按时间戳自动创建的工作目录，不读 `is_playground` / `conversation_origin`；该含义写入 `data-model.md` 的列说明。
- 判定只此一处，服务层与面板不重复路径规则（Spec R2）。

### 2. 维表：加列 + 版本递增

- `src/etl/index-db.ts`：`groups` 增加 `is_auto INTEGER NOT NULL DEFAULT 0`；`SCHEMA_VERSION` 由 2 递增 1 为 3。启动时版本不匹配即删库重建，不写迁移脚本。
- `DimensionWriter.ensureGroup` 的插入语句改为：

```sql
INSERT INTO groups (group_path, display_name, is_auto) VALUES (?, ?, ?)
ON CONFLICT(group_path) DO NOTHING
```

`is_auto = isAutoGroupPath(key)` 在插入时算出并随行固定，`key` 为 `groupPath ?? UNKNOWN_GROUP`；`display_name` 与 `group_path` 本来就不更新。

**取舍**

- **不加 `ON CONFLICT DO UPDATE`**：`is_auto` 是 `group_path` 的纯函数计算值，而 `group_path` 带 UNIQUE，同一业务键永远算出同一个结果，每次刷新重写它没有收益，还会改变 `ensureGroup` 既有的 `DO NOTHING` 写入语义、与 `data-model.md` 第 10 行「业务键换 id」的通用原则冲突。维表保持快照（C7 / C11）；判定规则变更属于生成规则变更，按 `data-model.md`「数据库结构与迁移」的既有约定递增 `SCHEMA_VERSION` 删库重建，不依赖增量刷新纠正存量行。
- `groupIds` 缓存只在单次刷新内有效（`refresh.ts` 的 `doRefresh` 每次 `new DimensionWriter(db)`），已存在的行由 `DO NOTHING` 跳过，不会因缓存绕过写入语义；外部会话被清理后原行与 `is_auto` 保留。
- `is_auto` 用 INTEGER 0/1 而不是布尔列，与 `requests.is_subagent` / `has_credit` 的既有写法一致，SQLite 无需转换。
- `未知分组` 与空 `cwd` 走 `UNKNOWN_GROUP` 分支，`isAutoGroupPath('未知分组')` 为 false，落 0。

### 3. 聚合：一处 CASE，一处 WHERE

`src/shared/constants.ts` 增加 `DEFAULT_GROUP = '默认'`，解析层、服务层与文档引用同一个常量，避免三处字面量漂移。

`server/query.ts`：

```ts
const GROUP_NAME = "COALESCE(g.display_name, g.group_path, '未知分组')";
const GROUP_KEY = `CASE WHEN g.is_auto = 1 THEN '${DEFAULT_GROUP}' ELSE COALESCE(g.group_path, '未知分组') END`;
const GROUP_LABEL = `CASE WHEN g.is_auto = 1 THEN '${DEFAULT_GROUP}' ELSE ${GROUP_NAME} END`;
```

- `dimensionColumns('group')` 返回 `key: GROUP_KEY`、`name: GROUP_LABEL`、`groupBy: GROUP_KEY`。`GROUP BY` 必须与 `key` 是同一个表达式，否则「默认」会被拆成多行；SQLite 支持按表达式分组，非聚合的 `name` 在同一组内取值恒定（自动分组恒为「默认」，手动分组每组一行，维表缺失恒为「未知分组」），`ORDER BY total_tokens DESC, key ASC` 仍按别名排序。
- `buildWhere`：`filters.group === DEFAULT_GROUP` 时压入 `g.is_auto = 1`（无参数），否则维持 `g.group_path = ?`。
- `getRequests` 的 `group_name` 改用 `GROUP_LABEL`；`group` 仍取 `g.group_path`（缺失时「未知分组」），业务键不随展示名改变。明细列的 `title` 仍取 `group`，hover 显示原始路径，属已知且接受的行为（Spec R6）。
- 占比仍由 `getBreakdown` 在 JS 里按聚合后的 `rows` 求和计算，合并成一行后自动正确；`COUNT(DISTINCT r.session_id)` 改为跨自动分组去重，不是各分组之和（Spec R4 / AC3）。

**取舍**

- 不在服务层做二次聚合：二次聚合要重算占比与 `COUNT(DISTINCT session_id)`，还得让 `getSummary` / `getTimeseries` 的筛选同步识别「默认」，反而把口径分散到多处。SQL 里一处 CASE + 一处 WHERE 最小且一致；四个端点共用 `buildWhere`，虚拟键筛选自动作用于所有视图。
- 表达式在 TS 里拼成常量再复用，避免 key / name / groupBy 三处手写不一致（这是本方案唯一容易出错的点，单测 AC3 兜住）。
- **不对展示名撞「默认」的手动分组做回退**：`GROUP_LABEL` 只有自动分组一个分支，手动分组仍返回 `display_name`。下拉可能出现两个同名「默认」项，但 `key` 分别是虚拟键与完整路径，选中与筛选互不影响（已确认决策）。
- 虚拟键不与业务键冲突：`group_path` 是完整 `cwd` 路径，或保留字「未知分组」，均不等于「默认」。

### 4. 面板：通用 `Select`

新增 `src/web/components/Select.tsx`，把 `ModelSelect` 的交互整体上移为通用组件：

```ts
interface SelectOption { key: string; name: string }

interface SelectProps {
  id?: string;
  className?: string;            // 加在容器 .select 上；紧凑宽度由 .select-compact 下的 trigger 规则实现
  label: string;                 // listbox 的 aria-label
  options: SelectOption[];       // 第一项由调用方提供空值文案
  value: string;                 // '' 表示不筛选
  onChange: (value: string) => void;
  renderLeading?: (key: string) => ReactNode;  // 仅模型传
}
```

- 行为沿用现有 `ModelSelect`：`aria-haspopup="listbox"`、`aria-expanded`、`aria-controls`、`aria-activedescendant`、`aria-selected`，↑↓ / Enter / Space / Esc、点击外部关闭，`useId` 生成 listbox 与 option id（多实例唯一），当前值不在 `options` 时插到第 2 项兜底并以值本身作展示名。**不新增 Tab 键行为**，与 Spec 行为 7 / R10 一致。
- `className` 加在容器 `.select` 上，`.filter-time-controls .select-compact` 的选择器需下钻到 `.select-trigger` 才设置 `width: auto` / `min-width: 112px`，否则时间预设的紧凑宽度会失效（AC12）。
- `FilterBar` 负责 `'' ↔ undefined` 映射：`Select` 用空字符串表示「全部」，`Filters` 用 `undefined`；`onChange` 里用 `value || undefined` 写回，取值时用 `filters.group ?? ''`。四个下拉的空值文案分别是「全部分组 / 全部对话 / 全部模型」，时间预设的空值项由 `PRESETS` 决定。
- 触发按钮与每个选项加 `data-value`（业务键），供验收脚本读取与点击；原 `data-model` 只服务模型，统一后由 `data-value` 取代。`renderLeading` 保持现有视觉：非空键渲染 `<ModelDot />`，选项的空键渲染空环 `span.model-dot.is-empty`，触发按钮的空键不渲染图标。
- `FilterBar` 四个下拉都用 `Select`：选项数组由 `PRESETS` 与 `groupOptions` / `sessionOptions` / `modelOptions` 映射；时间预设传 `className="select-compact"`；模型传 `renderLeading`。
- 删除 `src/web/components/ModelSelect.tsx` 与 `FilterBar` 的 `renderOptions`；`#filter-model` / `#filter-group` 等 id 保留在触发按钮上，外部 `label htmlFor` 行为不变。
- CSS：`.model-select*` 改名为 `.select*`（`.select`、`.select-trigger`、`.select-value`、`.select-chevron`、`.select-list`、`.select-option`、`.select-compact`），`.filter-field select` 收窄为 `.filter-field input[type='date']`，`.filter-field select:focus` 迁到 `.select-trigger:focus-visible`，`.filter-time-controls select` 改为 `.filter-time-controls .select-compact .select-trigger`（宽度 auto、最小 112px）。视觉尺寸沿用 34px 高、8px 圆角与现有色变量。

**取舍**：不引入 Radix / headless UI —— 只有一个下拉形态，引入依赖会带来样式重写与打包体积；也不把 `Select` 做成带搜索、多选的通用控件，避免超出 Spec 范围。日期输入仍是原生控件（日历交互无法用 listbox 等价替代）。

### 5. 趋势图 tooltip 过滤 0 值

`TrendChart` 的 tooltip 增加 `formatter`，与 `valueFormatter` 共用同一个格式化函数 `formatValue`（`metric === 'tokens' ? formatTokens : formatCredit`）：

```ts
tooltip: {
  trigger: 'axis',
  axisPointer: { type: 'shadow' },
  valueFormatter: (value) => formatValue(Number(value)),
  formatter: (params) => {
    const raw = Array.isArray(params) ? params : [params];
    const axis = escapeHtml(String(raw[0]?.axisValue ?? ''));
    const list = raw
      .filter((item) => Number(item.value) > 0)
      .sort((left, right) => Number(right.value) - Number(left.value));
    if (list.length === 0) {
      return `${axis}<br/>无数据`;
    }
    return [axis, ...list.map((item) => `${item.marker}${escapeHtml(item.seriesName ?? '')}：${formatValue(Number(item.value))}`)].join('<br/>');
  },
}
```

- **日期必须从过滤前的 `params` 取**：先过滤再取 `list[0]?.axisValue` 会在全 0 日拿到 `undefined`，导致「无数据」时丢失日期，违反 AC13 / 行为 8。
- `valueFormatter` 保留，供验收脚本 AC5 读取；同时存在 `formatter` 时它在运行时不生效，属兼容既有断言的显式保留，不是另一套口径。两者共用 `formatValue`，保证数值格式不变。
- `data` 仍按天补 0：改成 `null` 会让堆叠与 tooltip 行为依赖 ECharts 内部实现，显式过滤更可控。
- 提示内容按 HTML 渲染，模型展示名来自本地数据，`escapeHtml` 做最小转义，避免名称里的 `<` 破坏结构。
- 两张图共用组件，规则同时生效（已确认）；验收时分别在 Token 与积分图上验证。

### 6. 验收脚本适配

`scripts/panel-acceptance.mjs`：

- `setPreset` 改为点击 `#filter-preset` 展开后点 `.select-option[data-value=${value}]`（**参数化**，脚本同时用 `'all'` 与 `'today'`）；AC1 的分组下拉读写改为 `#filter-group` 的 `data-value` 与 `.select-option[data-value=...]` 点击。
- `selectModel` / `readModelOptions` 改读 `.select-option` 与 trigger 的 `data-value`；色点断言的选择器 `.model-dot` 不变。
- `chartStateExpr` 增加对 `option.tooltip[0].formatter` 的读取：在页面上下文构造含 0 / 非 0 的 params 调用它并 stringify 返回，供 AC13 断言。
- 新增断言：
  - **AC2**：服务层聚合结果驱动的分组选项不含 `YYYY-MM-DD-HH-MM-SS` 形态条目（断言排除当前值兜底项，见 Spec 边界表）；API 返回「默认」时下拉必须含该项，API 不含时下拉也不含该项（不占位）。
  - **AC4**：选中「默认」后 summary 请求带 `group=%E9%BB%98%E8%AE%A4` 且触发值回显；并分别请求 `/api/summary`、`/api/timeseries`、`/api/breakdown?dim=group|session|model`、`/api/requests`，断言各视图数据只含自动分组、不含手动分组业务键。
  - **AC9**：页面 resource entries 中不出现外部域名请求；WorkBuddy 数据库文件指纹不变由既有只读单测 + 人工实测记录。
  - **AC12**：四个 trigger 的 `role` 与 `aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected` 组合全量检查；在一个代表性下拉上用页面上下文派发 `KeyboardEvent`（↑↓ / Enter / Esc）与 `pointerdown` 断言移动、选中、关闭、点击外部关闭；时间预设紧凑宽度与「自定义」日期框行为不变。
  - **AC13**：分别在 Token 与积分图上取 formatter 结果断言 0 项被剔除、非 0 项保留、全 0 时同时含日期与「无数据」；两张图结果一致。
- 既有 10 项断言语义与阈值不放宽，只换选择器；AC14 要求脚本实际运行，环境不具备时记为未验证风险。
- **前置条件**：脚本运行前**重启 API 进程**（见顺序约束 6）；`openIndex()` 删库重建后 `server/index.ts` 启动时已自动完成一次全量刷新，无需手动点「刷新数据」。

## 影响范围

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 解析 | `src/etl/dimensions.ts` | `isAutoGroupPath`；`ensureGroup` 插入时携带 `is_auto` |
| 解析 | `src/etl/index-db.ts` | `groups.is_auto` 列；`SCHEMA_VERSION` 2 → 3 |
| 共享 | `src/shared/constants.ts` | 新增 `DEFAULT_GROUP` |
| 服务 | `server/query.ts` | 分组 CASE 聚合、虚拟键筛选、明细展示名 |
| 面板 | `src/web/components/Select.tsx`（新增）、`ModelSelect.tsx`（删除）、`FilterBar.tsx`、`TrendChart.tsx`、`src/web/styles.css` | 下拉统一、提示过滤 |
| 测试 | `tests/dimensions.test.ts`、`tests/index-db.test.ts`、`tests/group-normalization.test.ts`（新增）、`tests/helpers/` | 判定、维表、聚合、虚拟键、明细 |
| 脚本 | `scripts/panel-acceptance.mjs` | DOM 适配与新增断言 |
| 文档 | `docs/data-model.md`、`docs/technical-architecture.md`、`docs/product-brief.md`、`docs/integration.md` | 结构、口径、接口参数、兼容性风险 |

## 数据与接口变化

- **数据库**：`groups` 多一列；`SCHEMA_VERSION` 递增，旧库删除重建，内部 `id` 重新分配。API 仍只用业务键（C14）。`is_auto` 在插入时确定后不变。
- **API 参数**：`group` 新增虚拟值「默认」，映射 `g.is_auto = 1`；其它取值语义不变（含日期路径的旧参数仍按原路径精确匹配）。`readFilters` 无白名单，无需改动。
- **API 返回**：`/api/breakdown?dim=group` 不再返回日期路径行，改为一行 `key = name = 默认`，且仅在当前筛选范围存在自动分组请求时出现；手动分组展示名撞「默认」时仍返回 `display_name`，可与虚拟键同名但业务键不同。`/api/requests` 的 `groupName` 对自动分组返回「默认」，`group` 仍是原始 `group_path`。字段结构不变，无需前端类型改动。
- **面板**：下拉 DOM 由原生 `select` 变为 button + listbox，`id` 与筛选值不变；筛选状态只在内存，无本地持久化迁移。明细分组列 hover 仍显示原始路径。

## 顺序约束

1. **解析层 → 服务层 → 面板**：服务层 SQL 引用 `g.is_auto`，必须在加列与版本递增之后；否则运行时 `no such column`。
2. **下拉统一先于验收脚本改造**：脚本要按新 DOM 重写，先改组件再改脚本，避免同一选择器改两遍。
3. **tooltip 改动与下拉统一互不依赖**，都在脚本改造前完成即可。
4. **文档同步放在实现与验证通过后**，避免把设想写成事实。
5. **Spec 与 Plan 确认后先做一次 docs 固化提交**（AGENTS.md 第 2 节），再进入 T001；该提交不关联 Tasks 文档。
6. **验收前必须重启 API 进程**：`SCHEMA_VERSION` 只在启动时的 `openIndex()` 检查，点「刷新数据」仅触发 `refresher.refresh()`，不会重建缺列的表；未重启会让所有 API 因 `no such column` 失败。

## 测试策略

- **单测（纯函数）**：`isAutoGroupPath` 覆盖 macOS POSIX、Windows 盘符与反斜杠、末尾分隔符、大小写 `workbuddy`、日期末段但父目录不同、`WorkBuddy` 下非日期目录、空串、根路径、单段路径。
- **单测（维表）**：`ensureGroup` 写入 `is_auto`；重复 `ensureGroup` 不新增行且 `is_auto` / `display_name` 保持不变（验证 `DO NOTHING` 快照语义）；`未知分组` 与空 `cwd` 的 `is_auto = 0`。不写「同一路径刷新后 `is_auto` 变化」这类不可能成立的断言。
- **单测（结构）**：`SCHEMA_VERSION` 递增后旧库删除重建；`groups` 新列存在且默认 0；连续两次全量重建的 `groups` 行集合一致、与文件遍历顺序无关。
- **单测（服务层）**：用独立夹具（手动分组 + 两个日期目录 + 空 `cwd` + 一个展示名为「默认」的手动分组）断言：日期分组聚合成一行「默认」、数值等于按现有口径重新聚合、占比按全量、会话数按跨分组去重；手动分组行数与数值不变、撞名分组 `name` 仍是「默认」且 `key` 是完整路径；`group=默认` 下四个端点都只返回自动分组数据；`/api/requests` 的 `groupName` 为「默认」而 `group` 为原始路径；两次重建的 group 聚合结果一致；三视图求和仍等于总览。
- **面板验证**：`npm run typecheck`、`npm test`、`npm run build`；`npm run acceptance` 既有 10 项 + 新增断言（需 `npm run dev`、带 `--remote-debugging-port` 的 Chrome，且验收前已重启 API 进程）。脚本必须实际运行，否则 AC14 记为未验证风险并写进收尾记录。
- **手工检查**：四个下拉的键盘操作、点击外部关闭；时间预设选「自定义」仍出现日期框；hover 有 0 值与全 0 的两天；结果记入 T008。

## 风险与回滚

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| WorkBuddy 改变自动目录命名 | 新目录被判为手动分组，下拉重新出现条目 | 已写入 `integration.md` 兼容性风险；更新规则并递增 `SCHEMA_VERSION` 重建，不依赖增量刷新 |
| 判定规则变更但未递增版本号 | 存量 `is_auto` 不更新，聚合结果错误 | 判定规则变更必须递增 `SCHEMA_VERSION`（`data-model.md` 既有约定）；T002 单测覆盖重建 |
| `GROUP BY` 与 `key` 表达式不一致 | 「默认」被拆成多行、占比失真 | 表达式由同一常量拼装；AC3 单测断言求和与行数 |
| 下拉出现两个同名「默认」项 | 用户可能分不清 | 已确认不做去重；`key` 不同、筛选互不影响，边界表记录 |
| 自定义下拉替换导致验收脚本选择器失效 | 验收失败，可能掩盖真实回归 | 脚本同批改造；断言语义不放宽，只换选择器 |
| tooltip formatter 改变提示结构 | 提示缺项或转义错误 | 日期从过滤前的 `params` 取；单测/脚本断言 0 值、保留项与全 0 日；`escapeHtml` 处理展示名 |
| 删库重建期间首次刷新耗时 | 首次打开慢 | 现有机制，秒级；启动即自动全量刷新，不新增操作步骤 |
| 验收前未重启 API 进程 | 旧库缺 `is_auto` 列，所有 API 失败 | 顺序约束 6；T006 前置条件明确 |

**回滚**：解析层与维表改动可用一次提交回退（`[revert]`），回退后 `SCHEMA_VERSION` 回到 2，旧库会被再次删除重建；面板改动独立于口径，可单独回退 `Select` / `TrendChart` 提交而不影响统计结果。

## 文档同步

- `data-model.md`：`groups` 表加 `is_auto` 列并说明其含义（按时间戳自动创建的工作目录）与「插入时确定、规则变更靠版本重建」；C7 / C11 的判定与快照说明；`schema_version` 由 2 增至 3。第 10 行「业务键换 id」的 `ON CONFLICT DO NOTHING` 通用原则保持不变，无需改写。
- `technical-architecture.md`：接口表 `group` 参数的虚拟键、解析层判定位置、面板下拉与提示的行为说明；不改动其它实测快照数字。
- `product-brief.md`：关键术语「分组」补充自动目录归入「默认」、筛选条件仍为四项。
- `integration.md`：`group_id` / `group_title` / `project_id` 全为 NULL 的实测事实、路径判据、目录格式变化的兼容性风险；实测快照数字标注日期。
