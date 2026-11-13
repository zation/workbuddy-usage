# T001 自动分组判定与单测

状态：done

目标与完成条件：在 `src/etl/dimensions.ts` 新增并导出 `isAutoGroupPath(value: string): boolean`，紧邻 `lastPathSegment` 实现：按 `/[\\/]+/u` 切分并去掉空段，取末段与倒数第二段，末段匹配 `^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$`、倒数第二段忽略大小写等于 `workbuddy` 时返回 `true`。语义上 `true` 只表示 `cwd` 是 WorkBuddy 按时间戳自动创建的工作目录，不依据 `is_playground` / `conversation_origin` 等会话字段。不引入 `node:path`，不硬编码用户名、盘符或 home 目录，不做日期合法性校验。`tests/dimensions.test.ts` 补齐用例：macOS POSIX 路径、Windows 盘符与反斜杠路径、末尾分隔符、`WorkBuddy` 大小写差异、日期末段但父目录不同、`WorkBuddy` 下非日期目录、空串、根路径 `/`、单段路径、倒数第二段是 `workbuddy` 但末段不是日期。对应 Spec R1、AC1。

修改范围：`src/etl/dimensions.ts`、`tests/dimensions.test.ts`。

实施结果：`isAutoGroupPath` 与 `AUTO_GROUP_DIR` 紧跟 `lastPathSegment`，两种分隔符统一切分后取末两段，父段 `toLowerCase()` 比较，段数不足 2 直接返回 `false`——根路径、单段路径与空串由此覆盖，无需特判。用例按 5 组组织，补了混合分隔符、`WorkBuddy-backup` 父目录、位数不足的日期与本交付相关的非日期形态。

验证：`npm run typecheck` 通过；`npx vitest run tests/dimensions.test.ts` 17 项通过（新增 5 项）。

提交：f6b79b1

# T002 维表 `is_auto` 与结构版本递增

状态：done

目标与完成条件：`src/etl/index-db.ts` 的 `groups` 表增加 `is_auto INTEGER NOT NULL DEFAULT 0`，`SCHEMA_VERSION` 由 2 递增 1 为 3；不写迁移脚本。`DimensionWriter.ensureGroup` 的插入改为携带 `is_auto = isAutoGroupPath(key)`，冲突仍为 `ON CONFLICT DO NOTHING`，**不加 `DO UPDATE`**：`is_auto` 是 `group_path` 的纯函数派生值、同一 UNIQUE 业务键恒定，重写无收益且会改变既有写入语义；判定规则变更靠 `SCHEMA_VERSION` 递增重建。`未知分组` 与空 `cwd` 的 `is_auto` 为 0。`tests/index-db.test.ts` 断言 `groups` 新列与默认值、版本递增后旧库删除重建、连续两次全量重建的 `groups` 行集合一致且与文件遍历顺序无关；`tests/dimensions.test.ts` 断言重复 `ensureGroup` 不新增行且 `is_auto` / `display_name` 保持不变。不写「同一路径二次刷新后 `is_auto` 变化」这类不可能成立的断言。对应 Spec R2、R3、AC8。

必要依赖：T001。

修改范围：`src/etl/index-db.ts`、`src/etl/dimensions.ts`、`tests/index-db.test.ts`、`tests/dimensions.test.ts`。

实施结果：`SCHEMA_VERSION` 3，`groups` 末尾加 `is_auto INTEGER NOT NULL DEFAULT 0`；`ensureGroup` 的插入语句带三列，值由 `isAutoGroupPath(key) ? 1 : 0` 算出，仍为 `DO NOTHING`。`未知分组` 走同一函数返回 false，自然落 0，未加特判。测试用「先写入、手动改成 0、再新建写入器重复 `ensureGroup`」验证 `DO NOTHING` 不回写已有行；结构侧用两次删库重建 + 逆序写入比对 `groups` 行集合，并核对了日期目录与普通目录的 `is_auto` 取值。

验证：`npm run typecheck` 通过；`npx vitest run tests/dimensions.test.ts tests/index-db.test.ts` 24 项通过（新增 2 项结构断言、1 项维表断言）。

提交：a447d1c、de3df65

# T003 服务层分组聚合与虚拟业务键

状态：done

目标与完成条件：`src/shared/constants.ts` 新增 `DEFAULT_GROUP = '默认'`。`server/query.ts` 用同一组 TS 常量拼出分组的 `key` / `name` / `GROUP BY` 表达式：自动分组的 `key` 与 `name` 均为「默认」，`GROUP BY` 使用与 `key` 完全相同的表达式；`GROUP_LABEL` 只有自动分组一个分支，其余返回 `COALESCE(g.display_name, g.group_path, '未知分组')`，**不对手动分组展示名撞「默认」做回退**（允许两个同名项，业务键不同、筛选互不影响）；`buildWhere` 在 `group === DEFAULT_GROUP` 时压入 `g.is_auto = 1`，其它取值维持 `g.group_path = ?`；`getRequests` 的 `group_name` 使用同一表达式，`group` 仍返回原始 `group_path`，明细 hover 仍为原始路径。新增 `tests/group-normalization.test.ts`（独立夹具：手动分组 + 两个日期目录 + 空 `cwd` + 一个展示名为「默认」的手动分组），断言：日期分组聚合成一行、数值等于按现有口径重新聚合、占比按全量、会话数按跨分组去重；手动分组行数与数值不变、撞名分组 `name` 仍是「默认」且 `key` 是完整路径；四个端点在 `group=默认` 下都只返回自动分组数据；明细展示名与业务键分离；两次重建的 group 聚合结果一致；三视图求和等于总览。对应 Spec R4–R8、AC3 / AC4 / AC5 / AC6 / AC7 / AC8。

必要依赖：T002。

修改范围：`server/query.ts`、`src/shared/constants.ts`、`tests/group-normalization.test.ts`、`tests/helpers/`。

实施结果：`GROUP_NAME` / `GROUP_KEY` / `GROUP_LABEL` 三个模块常量由 `DEFAULT_GROUP` 拼装，`dimensionColumns('group')` 的 `key` 与 `groupBy` 引用同一个 `GROUP_KEY`；`buildWhere` 先判虚拟键再走路径匹配；`getRequests` 的 `group_name` 改用 `GROUP_LABEL`，`group` 仍取 `g.group_path`。夹具含 6 个分组（自动 2、手动 3、未知 1），token 合计 2100、自动分组 700 / 2 请求 / 2 会话 / 积分 2；「等于重新聚合」改为逐日期路径比对 `/api/breakdown` 与 `/api/requests` 的实际求和，避免只比同一行而失真。测试文件内自带夹具，未改动 `tests/helpers/`。

验证：`npm run typecheck` 通过；`npx vitest run tests/group-normalization.test.ts` 8 项通过；`npm test` 全量 111 项通过、1 项平台条件跳过（`it.skipIf(win32)`，既存）。

提交：077f8b7

# T004 通用下拉组件与 `FilterBar` 统一

状态：done

目标与完成条件：新增 `src/web/components/Select.tsx`，把 `ModelSelect` 的 combobox 行为上移为通用组件（button + `role="listbox"` / `role="option"`、`aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected`、↑↓ / Enter / Space / Esc、点击外部关闭、`useId` 保证多实例唯一、当前值不在选项中时插兜底项）；键盘范围沿用现有模型下拉，**不新增 Tab 行为**。props 提供 `options` / `value` / `onChange` / `label` / 可选 `renderLeading` 与 `className`；`className` 加在容器 `.select` 上，紧凑宽度规则下钻到 `.select-trigger`。`FilterBar` 负责 `'' ↔ undefined` 映射（`onChange` 用 `value || undefined` 写回，取值用 `filters.group ?? ''`）。触发按钮与选项输出 `data-value` 业务键；`renderLeading` 保持现有视觉（非空键 `<ModelDot />`，选项空键空环，触发按钮空键不渲染图标）。`FilterBar` 的时间预设、分组、对话、模型四个下拉全部改用该组件，空值文案分别为「全部分组 / 全部对话 / 全部模型」，时间预设使用紧凑宽度类名，日期输入框保持原生。删除 `ModelSelect.tsx` 与 `renderOptions`；`.model-select*` 样式改名为 `.select*` 并补 `.select-compact`，`.filter-field select` 收窄为日期输入，`.filter-field select:focus` 迁到 `.select-trigger:focus-visible`，`.filter-time-controls select` 改为 `.filter-time-controls .select-compact .select-trigger`。对应 Spec R10、R12、AC12（键盘与 ARIA 断言由 T006 承担）。

修改范围：`src/web/components/Select.tsx`、`src/web/components/ModelSelect.tsx`（删除）、`src/web/components/FilterBar.tsx`、`src/web/styles.css`。

实施结果：`Select` 承接原 `ModelSelect` 的全部行为，`onChange` 统一回传字符串（空串表示不筛选），兜底项插在索引 1；`renderLeading` 仅在传入时渲染，空键选项渲染空环、触发按钮空键不渲染图标。`FilterBar` 内新增 `dimensionOptions` 与模块级 `PRESET_OPTIONS`，四处下拉分别传 `label`（时间范围 / 分组 / 对话 / 模型），模型传 `renderLeading`。样式除改名外，把日期输入的两段规则合并为一条并新增 `.select-compact { width: auto }`——容器若仍为 `width: 100%`，时间预设会占满整行、把日期框挤到下一行。

验证：`npm run typecheck` 通过；`npm test` 全量 111 项通过、1 项平台条件跳过；`npm run build` 通过（Vite 仍有既存 chunk 体积提示）。下拉的键盘、ARIA 与紧凑宽度的实际表现由 T006 验收脚本承担。

提交：04902ec、de3df65

# T005 趋势图 tooltip 过滤 0 值

状态：done

目标与完成条件：`TrendChart` 的 tooltip 增加 `formatter`：从**过滤前的 `params`** 取 `axisValue` 作为首行日期（避免全 0 日丢失日期），过滤数值 ≤ 0 的系列，保留项按数值降序，每行色点 + 展示名 + 格式化值；无保留项时只显示日期与「无数据」；`valueFormatter` 保留并与 formatter 共用同一格式化函数 `formatValue`（`formatTokens` / `formatCredit`），供验收脚本 AC5 读取，运行时由 formatter 接管。`series.data` 仍按天补 0，堆叠、坐标轴与合计口径不变。展示名与日期做最小 HTML 转义。两张图共用组件，规则同时生效，分别验证由 T006 承担。对应 Spec R11、AC13。

修改范围：`src/web/components/TrendChart.tsx`。

实施结果：`formatValue` 在 `useMemo` 内按 `metric` 绑定，`valueFormatter` 与 `formatter` 共用；`formatter` 先取 `raw[0].axisValue` 再过滤 `Number(value) > 0` 并按数值降序，保留项输出 `marker + 转义后的展示名 + 全角冒号 + 格式化值`，无保留项返回「日期 + 无数据」。ECharts 的 `CallbackDataParams` 没有 `axisValue` 字段，用本地 `TooltipParam` 接口承接运行时结构，未改动 `series.data` 与堆叠配置。

验证：`npm run typecheck` 通过；`npm run build` 通过。提示内容的实际渲染与两张图一致性由 T006 验收脚本断言。

提交：cf7c745

# T006 验收脚本适配与新增断言

状态：done

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

实施结果：新增 `chooseOption`（展开与点选分两次 evaluate，等 React 重渲染）与 `readSelect`（按容器读 `data-value` 与选项），`setPreset` / `selectModel` 均改为调用前者；AC1 的读写改用 `dataset.value`，选项按 `#filter-*` 所属 `.select` 容器限定，避免四个列表同名选项互相干扰。`chartStateExpr` 增加 `formatter` 探针，用固定 params 调出「混合 0 值」与「全 0」两种结果。新增 6 项断言：AC9 在清空 resource entries 之前读取；AC2 用「下拉选项集合 == `/api/breakdown?dim=group` 业务键集合」同时覆盖有/无「默认」，并用 `custom` 预设把区间设到 2099-01-01 造出空范围验证不占位；AC4 以 `/api/requests` 为基准核对会话、模型、token 与另外三个端点一致；AC12 检查四个 trigger 的 role/haspopup/expanded/controls/activedescendant/aria-selected，在分组下拉上派发 ↑↓ / Enter / Esc / pointerdown；AC13 在两张图上各调一次 formatter。

实施中遇到一次环境问题：派生库恰在「加列已生效、判定尚未写入」的中间态被重建，`is_auto` 全为 0；按既有约定删 `.data/index.db` 后重启重建即恢复（`默认` 聚合为一行、分组从 67 行降到 9 行）。这也验证了「判定规则变化必须整库重建」的必要性。

验证：`SCREENSHOT_DIR=.data/acceptance-shots node scripts/panel-acceptance.mjs` 实跑，16 项全 PASS（既有 10 项 + 新增 AC9 / AC2×2 / AC4 / AC12 / AC13），退出码 0；`npm run typecheck` 通过。

提交：101acfb

# T007 长期文档同步

状态：done

目标与完成条件：更新 `data-model.md`（`groups.is_auto` 列并说明「按时间戳自动创建的工作目录」与「插入时确定、规则变更靠版本重建」、C7 / C11 的判定与快照说明、`schema_version` 由 2 增至 3；第 10 行 `ON CONFLICT DO NOTHING` 通用原则保持不变）、`technical-architecture.md`（`group` 参数的虚拟键「默认」、解析层判定位置、面板下拉与提示行为；不改动其它实测快照数字）、`product-brief.md`（关键术语「分组」补充自动目录归入「默认」、筛选条件仍为四项）、`integration.md`（`group_id` / `group_title` / `project_id` 全为 NULL 的实测事实、路径判据与目录格式变化的兼容性风险、实测快照数字标注日期）。文档只写当前实现与约束，不复制实现细节，不把不同日期的实测数字混用。对应 Spec AC11。

必要依赖：T001–T006。

修改范围：`docs/data-model.md`、`docs/technical-architecture.md`、`docs/product-brief.md`、`docs/integration.md`。

实施结果：`data-model.md` 的 `groups` 表补 `is_auto` 列与语义段（含「插入时确定、`DO NOTHING` 不改写、规则变更靠版本重建」），C7 / C11 各补一句快照行为，版本管理补「由 2 增至 3」。`technical-architecture.md` 在接口段补 `group` 的虚拟键与单独一段「分组口径归一化」（判定位置、聚合与筛选、撞名不回退、API 结构不变），模块划分段补四个下拉共用 `Select` 与 tooltip 过滤行为，数据量一行补「分组行数不再随自动目录增长」而不改其它快照数字，路径处理一行补 `node:path` 的例外（自动目录判定固定接受两种分隔符，避免与实现冲突）。`product-brief.md` 在「分组」术语里补自动目录归入「默认」并重申四项筛选。`integration.md` 补 2026-11-13 实测（148 行会话、三个分组字段非空数均为 0、16 行空 `cwd`、81 行自动目录路径）、判据说明与「自动目录命名格式变化」风险行。

验证：人工通读四份文档与实现逐条对照（列名、版本号、虚拟键、判定与快照语义、面板行为、风险应对）；`grep` 确认长期文档中无残留的旧口径描述。未改动 v1.0.0 归档文档。

提交：bbabcc6

# T008 交付收尾检查

状态：done

目标与完成条件：逐项核对 Spec 的 AC1–AC14 是否满足；核对各任务状态与实施记录，一次性回填所有已实施任务的「提交」字段；确认 Spec / Plan 的 docs 固化提交已完成（AGENTS.md 第 2 节）、四份长期文档与实现一致、无已知矛盾；AC10 的分组相关断言调整逐条列明（不得直接删除或跳过）；手工检查（四个下拉键盘、点击外部关闭、自定义日期框、有 0 值与全 0 两天的 hover）结果记入本任务；`docs/backlog/` 仅有子代理积分条目且本交付明确不处理，核对无需更新即可。全量运行 `npm run typecheck`、`npm test`、`npm run build`；`npm run acceptance` 按 AC14 必须实际运行，未执行或环境不具备时记为「未验证风险」并说明原因，不得记为通过。收尾提交不填「提交」字段。对应 AGENTS.md 第 5 节。

必要依赖：T001–T007。

修改范围：`docs/delivery/group-normalization-tasks.md`。

实施结果：

**验收标准逐项结论**

- AC1：`tests/dimensions.test.ts` 5 组用例覆盖 POSIX / Windows 分隔符、末尾分隔符、大小写、父目录不符、非日期末段、空串 / 根路径 / 单段路径，全部通过。
- AC2：验收脚本「分组下拉无日期目录条目且与聚合结果一致」（选项 9 项、日期条目 0 项、下拉与接口的「默认」存在性一致）与「空范围内『默认』不占位」（接口 0 行、下拉仅 1 项空值项）均 PASS。
- AC3：`tests/group-normalization.test.ts` 断言合并行数值等于逐路径 `/api/breakdown` + `/api/requests` 的实际求和（token / 积分 / 请求数 / 会话去重）；验收脚本进一步核对「默认」筛选下 timeseries 合计与 summary 一致。
- AC4：验收脚本核对 summary 请求带 `group=%E9%BB%98%E8%AE%A4`、触发值回显、`dim=group` 仅一行、明细 186 条全为自动路径、会话与模型集合与明细一致；单测覆盖四个端点的同一断言。
- AC5：单测断言 `groupName = 默认` 而 `group` 仍为原始路径（含撞名分组与「未知分组」）。
- AC6：单测三视图求和均 2100 且等于总览；既有 `tests/api.test.ts` 的 AC3 断言未改动仍通过。
- AC7：「未知分组」独立成行（500，不并入 700），既有 AC7 用例未改动仍通过。
- AC8：`tests/index-db.test.ts` 两次删库重建 + 逆序写入行集合一致；`tests/group-normalization.test.ts` 断言重建前后 group 聚合逐行相同。
- AC9：既有 `scan-external.test.ts` 覆盖只读连接拒绝写入；本轮额外实测连续 3 次 `POST /api/refresh`，`workbuddy.db` / `-wal` / `-shm` 的 size 与 mtime 前后完全一致（首次比对出现差异，同时 `changedFiles = 1`，是 WorkBuddy 自身写入，重测基线稳定后三轮均无变化）；验收脚本 AC9 断言页面无外部域名请求。
- AC10：**无需调整任何既有断言**。`tests/acceptance.test.ts` 与面板断言未改动即全部通过；分组相关断言中没有按日期业务键硬编码的映射，`默认` 的引入未改变既有覆盖范围，因此本项没有「调整前后对照」需要列明。
- AC11：T007 已同步四份长期文档，本轮复核列名、版本号、虚拟键、判定与快照语义、面板行为与风险条目均与实现一致；`grep` 确认长期文档无残留旧口径。
- AC12：验收脚本检查四个 trigger 的 `role=combobox` / `aria-haspopup=listbox` / `aria-expanded=false` / `aria-controls` 指向存在元素 / `aria-activedescendant` 为空 / 每个下拉恰有一项 `aria-selected=true`；在分组下拉上派发 ↑↓ 移动、Enter 选中、Esc 关闭、`pointerdown` 点击外部关闭全部符合预期；时间预设宽 112px（同列全宽 237px），「自定义」下渲染 2 个原生日期输入。
- AC13：验收脚本在 Token 与积分图上各调一次 formatter，断言 0 值被剔除、非 0 保留且按键值降序、全 0 时同时含日期与「无数据」；另在真实页面用 ECharts `showTip` 复核——2026-11-13 显示「2026-11-13 / DeepSeek-V4.1-Flash：4.7M / Hy4 (hy4-free)：470.1K」（11 个系列仅 2 个非 0），2026-10-29 显示「2026-10-29 / 无数据」。
- AC14：`npm run acceptance` 实跑 16 项全部 PASS、退出码 0。

**文档与流程**

Spec / Plan 的 docs 固化提交为 `b789161`（先于 T001）。T001–T007 的「提交」字段已回填；本收尾提交不填。`docs/backlog/` 只有 `subagent-credit-reconciliation.md`，本交付明确不处理，无需更新。

**剩余风险**

WorkBuddy 改变自动目录命名格式时判定会失效，已写入 `integration.md` 兼容性风险表，应对是更新规则并递增 `SCHEMA_VERSION` 重建；无其它未验证项。

**交付整体复核**

全部任务完成后按层复核了一遍 diff：解析层的判定与写入、服务层的 CASE / WHERE / 明细展示名、面板的组件与样式、验收脚本的选择器与新增断言、四份长期文档。发现并修复两处 polish（`de3df65`）：`SCHEMA_VERSION` 的注释只提「展示名规则」，补成「派生规则（展示名、自动分组判定等）」，避免下次改判定时漏递增；日期输入框在收窄选择器时内边距从 10px 变成 8px，与下拉触发按钮不再对齐，改回 10px。未发现功能性缺陷。

验证：

- `npm run typecheck`：通过。
- `npm test`：12 个文件、111 项通过，1 项 `it.skipIf(win32)` 平台条件跳过（既存）。
- `npm run build`：通过（Vite 仍有既存 chunk 体积提示）。
- `npm run acceptance`：16 项全部 PASS（既有 10 项 + 新增 6 项），退出码 0；运行前已重启 API 进程并删库重建，前置条件满足。

提交：
