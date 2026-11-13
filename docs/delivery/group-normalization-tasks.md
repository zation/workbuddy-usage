# T001 自动分组判定与单测

状态：done

目标与完成条件：在 `src/etl/dimensions.ts` 新增并导出 `isAutoGroupPath(value: string): boolean`，紧邻 `lastPathSegment` 实现：按 `/[\\/]+/u` 切分并去掉空段，取末段与倒数第二段，末段匹配 `^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$`、倒数第二段忽略大小写等于 `workbuddy` 时返回 `true`。语义上 `true` 只表示 `cwd` 是 WorkBuddy 按时间戳自动创建的工作目录，不依据 `is_playground` / `conversation_origin` 等会话字段。不引入 `node:path`，不硬编码用户名、盘符或 home 目录，不做日期合法性校验。`tests/dimensions.test.ts` 补齐用例：macOS POSIX 路径、Windows 盘符与反斜杠路径、末尾分隔符、`WorkBuddy` 大小写差异、日期末段但父目录不同、`WorkBuddy` 下非日期目录、空串、根路径 `/`、单段路径、倒数第二段是 `workbuddy` 但末段不是日期。对应 Spec R1、AC1。

修改范围：`src/etl/dimensions.ts`、`tests/dimensions.test.ts`。

实施结果：`isAutoGroupPath` 与 `AUTO_GROUP_DIR` 紧跟 `lastPathSegment`，两种分隔符统一切分后取末两段，父段 `toLowerCase()` 比较，段数不足 2 直接返回 `false`——根路径、单段路径与空串由此覆盖，无需特判。用例按 5 组组织，补了混合分隔符、`WorkBuddy-backup` 父目录、位数不足的日期与本交付相关的非日期形态。

验证：`npm run typecheck` 通过；`npx vitest run tests/dimensions.test.ts` 17 项通过（新增 5 项）。

提交：

# T002 维表 `is_auto` 与结构版本递增

状态：done

目标与完成条件：`src/etl/index-db.ts` 的 `groups` 表增加 `is_auto INTEGER NOT NULL DEFAULT 0`，`SCHEMA_VERSION` 由 2 递增 1 为 3；不写迁移脚本。`DimensionWriter.ensureGroup` 的插入改为携带 `is_auto = isAutoGroupPath(key)`，冲突仍为 `ON CONFLICT DO NOTHING`，**不加 `DO UPDATE`**：`is_auto` 是 `group_path` 的纯函数派生值、同一 UNIQUE 业务键恒定，重写无收益且会改变既有写入语义；判定规则变更靠 `SCHEMA_VERSION` 递增重建。`未知分组` 与空 `cwd` 的 `is_auto` 为 0。`tests/index-db.test.ts` 断言 `groups` 新列与默认值、版本递增后旧库删除重建、连续两次全量重建的 `groups` 行集合一致且与文件遍历顺序无关；`tests/dimensions.test.ts` 断言重复 `ensureGroup` 不新增行且 `is_auto` / `display_name` 保持不变。不写「同一路径二次刷新后 `is_auto` 变化」这类不可能成立的断言。对应 Spec R2、R3、AC8。

必要依赖：T001。

修改范围：`src/etl/index-db.ts`、`src/etl/dimensions.ts`、`tests/index-db.test.ts`、`tests/dimensions.test.ts`。

实施结果：`SCHEMA_VERSION` 3，`groups` 末尾加 `is_auto INTEGER NOT NULL DEFAULT 0`；`ensureGroup` 的插入语句带三列，值由 `isAutoGroupPath(key) ? 1 : 0` 算出，仍为 `DO NOTHING`。`未知分组` 走同一函数返回 false，自然落 0，未加特判。测试用「先写入、手动改成 0、再新建写入器重复 `ensureGroup`」验证 `DO NOTHING` 不回写已有行；结构侧用两次删库重建 + 逆序写入比对 `groups` 行集合，并核对了日期目录与普通目录的 `is_auto` 取值。

验证：`npm run typecheck` 通过；`npx vitest run tests/dimensions.test.ts tests/index-db.test.ts` 24 项通过（新增 2 项结构断言、1 项维表断言）。

提交：

# T003 服务层分组聚合与虚拟业务键

状态：done

目标与完成条件：`src/shared/constants.ts` 新增 `DEFAULT_GROUP = '默认'`。`server/query.ts` 用同一组 TS 常量拼出分组的 `key` / `name` / `GROUP BY` 表达式：自动分组的 `key` 与 `name` 均为「默认」，`GROUP BY` 使用与 `key` 完全相同的表达式；`GROUP_LABEL` 只有自动分组一个分支，其余返回 `COALESCE(g.display_name, g.group_path, '未知分组')`，**不对手动分组展示名撞「默认」做回退**（允许两个同名项，业务键不同、筛选互不影响）；`buildWhere` 在 `group === DEFAULT_GROUP` 时压入 `g.is_auto = 1`，其它取值维持 `g.group_path = ?`；`getRequests` 的 `group_name` 使用同一表达式，`group` 仍返回原始 `group_path`，明细 hover 仍为原始路径。新增 `tests/group-normalization.test.ts`（独立夹具：手动分组 + 两个日期目录 + 空 `cwd` + 一个展示名为「默认」的手动分组），断言：日期分组聚合成一行、数值等于按现有口径重新聚合、占比按全量、会话数按跨分组去重；手动分组行数与数值不变、撞名分组 `name` 仍是「默认」且 `key` 是完整路径；四个端点在 `group=默认` 下都只返回自动分组数据；明细展示名与业务键分离；两次重建的 group 聚合结果一致；三视图求和等于总览。对应 Spec R4–R8、AC3 / AC4 / AC5 / AC6 / AC7 / AC8。

必要依赖：T002。

修改范围：`server/query.ts`、`src/shared/constants.ts`、`tests/group-normalization.test.ts`、`tests/helpers/`。

实施结果：`GROUP_NAME` / `GROUP_KEY` / `GROUP_LABEL` 三个模块常量由 `DEFAULT_GROUP` 拼装，`dimensionColumns('group')` 的 `key` 与 `groupBy` 引用同一个 `GROUP_KEY`；`buildWhere` 先判虚拟键再走路径匹配；`getRequests` 的 `group_name` 改用 `GROUP_LABEL`，`group` 仍取 `g.group_path`。夹具含 6 个分组（自动 2、手动 3、未知 1），token 合计 2100、自动分组 700 / 2 请求 / 2 会话 / 积分 2；「等于重新聚合」改为逐日期路径比对 `/api/breakdown` 与 `/api/requests` 的实际求和，避免只比同一行而失真。测试文件内自带夹具，未改动 `tests/helpers/`。

验证：`npm run typecheck` 通过；`npx vitest run tests/group-normalization.test.ts` 8 项通过；`npm test` 全量 111 项通过、1 项平台条件跳过（`it.skipIf(win32)`，既存）。

提交：

# T004 通用下拉组件与 `FilterBar` 统一

状态：done

目标与完成条件：新增 `src/web/components/Select.tsx`，把 `ModelSelect` 的 combobox 行为上移为通用组件（button + `role="listbox"` / `role="option"`、`aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected`、↑↓ / Enter / Space / Esc、点击外部关闭、`useId` 保证多实例唯一、当前值不在选项中时插兜底项）；键盘范围沿用现有模型下拉，**不新增 Tab 行为**。props 提供 `options` / `value` / `onChange` / `label` / 可选 `renderLeading` 与 `className`；`className` 加在容器 `.select` 上，紧凑宽度规则下钻到 `.select-trigger`。`FilterBar` 负责 `'' ↔ undefined` 映射（`onChange` 用 `value || undefined` 写回，取值用 `filters.group ?? ''`）。触发按钮与选项输出 `data-value` 业务键；`renderLeading` 保持现有视觉（非空键 `<ModelDot />`，选项空键空环，触发按钮空键不渲染图标）。`FilterBar` 的时间预设、分组、对话、模型四个下拉全部改用该组件，空值文案分别为「全部分组 / 全部对话 / 全部模型」，时间预设使用紧凑宽度类名，日期输入框保持原生。删除 `ModelSelect.tsx` 与 `renderOptions`；`.model-select*` 样式改名为 `.select*` 并补 `.select-compact`，`.filter-field select` 收窄为日期输入，`.filter-field select:focus` 迁到 `.select-trigger:focus-visible`，`.filter-time-controls select` 改为 `.filter-time-controls .select-compact .select-trigger`。对应 Spec R10、R12、AC12（键盘与 ARIA 断言由 T006 承担）。

修改范围：`src/web/components/Select.tsx`、`src/web/components/ModelSelect.tsx`（删除）、`src/web/components/FilterBar.tsx`、`src/web/styles.css`。

实施结果：`Select` 承接原 `ModelSelect` 的全部行为，`onChange` 统一回传字符串（空串表示不筛选），兜底项插在索引 1；`renderLeading` 仅在传入时渲染，空键选项渲染空环、触发按钮空键不渲染图标。`FilterBar` 内新增 `dimensionOptions` 与模块级 `PRESET_OPTIONS`，四处下拉分别传 `label`（时间范围 / 分组 / 对话 / 模型），模型传 `renderLeading`。样式除改名外，把日期输入的两段规则合并为一条并新增 `.select-compact { width: auto }`——容器若仍为 `width: 100%`，时间预设会占满整行、把日期框挤到下一行。

验证：`npm run typecheck` 通过；`npm test` 全量 111 项通过、1 项平台条件跳过；`npm run build` 通过（Vite 仍有既存 chunk 体积提示）。下拉的键盘、ARIA 与紧凑宽度的实际表现由 T006 验收脚本承担。

提交：

# T005 趋势图 tooltip 过滤 0 值

状态：pending

目标与完成条件：`TrendChart` 的 tooltip 增加 `formatter`：从**过滤前的 `params`** 取 `axisValue` 作为首行日期（避免全 0 日丢失日期），过滤数值 ≤ 0 的系列，保留项按数值降序，每行色点 + 展示名 + 格式化值；无保留项时只显示日期与「无数据」；`valueFormatter` 保留并与 formatter 共用同一格式化函数 `formatValue`（`formatTokens` / `formatCredit`），供验收脚本 AC5 读取，运行时由 formatter 接管。`series.data` 仍按天补 0，堆叠、坐标轴与合计口径不变。展示名与日期做最小 HTML 转义。两张图共用组件，规则同时生效，分别验证由 T006 承担。对应 Spec R11、AC13。

修改范围：`src/web/components/TrendChart.tsx`。

# T006 验收脚本适配与新增断言

状态：pending

前置条件：脚本运行前**重启 API 进程**，让 `openIndex()` 按新 `SCHEMA_VERSION` 删库重建；启动时 `server/index.ts` 已自动完成一次全量刷新，不需要手动点「刷新数据」。未重启会让旧库缺 `is_auto` 列、所有 API 因 `no such column` 失败。

目标与完成条件：`scripts/panel-acceptance.mjs` 按新 DOM 适配：`setPreset` 改为点击 `#filter-preset` 后点 `.select-option[data-value=${value}]`（参数化，脚本同时用 `'all'` 与 `'today'`）；AC1 的分组下拉读写改为 `#filter-group` 的 `data-value` 与 `.select-option` 点击；`selectModel` / `readModelOptions` 改读 `.select-option` 与 trigger `data-value`，色点选择器 `.model-dot` 不变；`chartStateExpr` 增加对 `option.tooltip[0].formatter` 的读取与调用结果。新增断言：

- AC2：服务层聚合结果驱动的分组选项不含 `YYYY-MM-DD-HH-MM-SS` 形态条目（断言排除当前值兜底项）；API 返回「默认」时下拉含该项、API 不含时下拉也不含该项（不占位）。
- AC4：选中「默认」后 summary 请求带 `group=%E9%BB%98%E8%AE%A4` 且触发值回显；分别请求 `/api/summary`、`/api/timeseries`、`/api/breakdown?dim=group|session|model`、`/api/requests`，断言各视图数据只含自动分组、不含手动分组业务键。
- AC9：页面 resource entries 中不出现外部域名请求。
- AC12：四个 trigger 的 `role` 与 ARIA 属性组合全量检查；在一个代表性下拉上用页面上下文派发 `KeyboardEvent`（↑↓ / Enter / Esc）与 `pointerdown` 断言移动、选中、关闭、点击外部关闭；时间预设紧凑宽度与「自定义」日期框行为不变。
- AC13：分别在 Token 与积分图上取 formatter 结果断言 0 项被剔除、非 0 项保留、全 0 时同时含日期与「无数据」；两张图结果一致。

既有 10 项断言语义与阈值不放宽，只换选择器；`npm run acceptance` 必须实际运行，环境不具备时 AC14 记为「未验证风险」并说明原因，不得记为通过。对应 Spec AC2 / AC4 / AC9 / AC12 / AC13 / AC14。

必要依赖：T004、T005。

修改范围：`scripts/panel-acceptance.mjs`。

# T007 长期文档同步

状态：pending

目标与完成条件：更新 `data-model.md`（`groups.is_auto` 列并说明「按时间戳自动创建的工作目录」与「插入时确定、规则变更靠版本重建」、C7 / C11 的判定与快照说明、`schema_version` 由 2 增至 3；第 10 行 `ON CONFLICT DO NOTHING` 通用原则保持不变）、`technical-architecture.md`（`group` 参数的虚拟键「默认」、解析层判定位置、面板下拉与提示行为；不改动其它实测快照数字）、`product-brief.md`（关键术语「分组」补充自动目录归入「默认」、筛选条件仍为四项）、`integration.md`（`group_id` / `group_title` / `project_id` 全为 NULL 的实测事实、路径判据与目录格式变化的兼容性风险、实测快照数字标注日期）。文档只写当前实现与约束，不复制实现细节，不把不同日期的实测数字混用。对应 Spec AC11。

必要依赖：T001–T006。

修改范围：`docs/data-model.md`、`docs/technical-architecture.md`、`docs/product-brief.md`、`docs/integration.md`。

# T008 交付收尾检查

状态：pending

目标与完成条件：逐项核对 Spec 的 AC1–AC14 是否满足；核对各任务状态与实施记录，一次性回填所有已实施任务的「提交」字段；确认 Spec / Plan 的 docs 固化提交已完成（AGENTS.md 第 2 节）、四份长期文档与实现一致、无已知矛盾；AC10 的分组相关断言调整逐条列明（不得直接删除或跳过）；手工检查（四个下拉键盘、点击外部关闭、自定义日期框、有 0 值与全 0 两天的 hover）结果记入本任务；`docs/backlog/` 仅有子代理积分条目且本交付明确不处理，核对无需更新即可。全量运行 `npm run typecheck`、`npm test`、`npm run build`；`npm run acceptance` 按 AC14 必须实际运行，未执行或环境不具备时记为「未验证风险」并说明原因，不得记为通过。收尾提交不填「提交」字段。对应 AGENTS.md 第 5 节。

必要依赖：T001–T007。

修改范围：`docs/delivery/group-normalization-tasks.md`。
