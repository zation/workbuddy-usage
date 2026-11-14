# T001 色值纯函数与单测

状态：done

目标与完成条件：新建 `src/web/model-colors.ts`，集中承载系列前缀表（按长度降序最长匹配）、12 项显式色表、各系列保留档位、全局兜底色板与唯一入口 `modelColor(modelKey)`；色值全部是十六进制字面量，不在运行时换算 HSL；哈希用 FNV-1a 32 位且只作用于色表外标识；`未知模型` 固定中性灰。新建 `tests/model-colors.test.ts`，覆盖色值唯一与格式、同系列色相相近且系列内各档互不相同、不同系列可辨、前缀最长匹配（`mimo` vs `minimax`、`hy` 命中 `hy4-preview-f`、`kimi-k4` 落到绿色系）、未知前缀走全局兜底、同一标识重复计算一致、哈希输出固化，并断言组件不内联色值数组。对应 Spec R1–R4、AC1 / AC2 与 Plan「色值与档位的单一来源」。

修改范围：`src/web/model-colors.ts`、`tests/model-colors.test.ts`。

实施结果：新增 `model-colors.ts`，以静态十六进制字面量承载 7 个系列的前缀、12 项显式色表、每系列 3 个保留档位与 8 色全局兜底；导出 `modelColor()` / `modelSeries()` / `hashKey()` / `MODEL_COLOR_TABLE` / `FALLBACK_COLORS`。前缀按长度降序最长匹配，显式模型直接查表，色表外标识按 FNV-1a 32 位取该系列保留档位或全局兜底色板。数组字面量推断导致 `explicit` 出现可选属性，改用 `SERIES_INPUT: ModelSeries[]` 显式注解后再复制排序解决。

验证：`npm run typecheck` 通过；`npx vitest run tests/model-colors.test.ts` 8 项通过（色值唯一与格式、同系列色相相近、跨系列基准色可辨、前缀最长匹配、兜底固化值、重复计算一致、哈希输出固化、组件不内联色值）。

提交：b12bb0d

# T002 取色链路切换与旧代码清理

状态：done

目标与完成条件：`TrendChart` 删除 `colorIndex` prop，系列色直接取 `modelColor(modelKey)`，series 设 `id: modelKey`，加白色 1px 描边，删除顶层 `color: PALETTE`；`App` 删除 `modelPalette` 查询、`modelPaletteRows`、`modelColors` 与两处 `colorIndex` 传参；删除 `src/web/palette.ts`、`src/web/display.ts` 的 `modelColorIndex` 与 `tests/palette.test.ts`，`tests/display.test.ts` 移除对应 3 个用例并保留其它用例。0 值隐藏仍由 `modelOptions` + `visibleModelKeys` 驱动，聚合与筛选口径不变。对应 Spec R6 / R7、AC3 / AC5 与 Plan 顺序约束 1 / 2 / 4。

必要依赖：T001。

修改范围：`src/web/components/TrendChart.tsx`、`src/web/App.tsx`、`src/web/display.ts`、`src/web/palette.ts`、`tests/display.test.ts`、`tests/palette.test.ts`。

实施结果：`TrendChart` 删除 `colorIndex` prop 与顶层 `color: PALETTE`，系列色改由 `modelColor(modelKey)` 直接取得，series 增加 `id: modelKey` 并加 1px 白色描边以分辨同系列相邻堆叠块；`App` 删除 `modelPalette` 查询、`modelPaletteRows`、`modelColors` 与两处 `colorIndex` 传参；删除 `modelColorIndex`、`palette.ts`、`palette.test.ts` 及 `display.test.ts` 中对应 3 个用例。0 值隐藏仍由 `modelOptions` + `visibleModelKeys` 驱动，聚合与筛选口径未动。

验证：`npm run typecheck` 通过；`npx vitest run tests/display.test.ts tests/model-colors.test.ts` 22 项通过；`npm run build` 通过（Vite 仍有既存的 chunk 体积提示，非错误）。

提交：87f2f3f

# T003 色点组件与列表、明细着色

状态：done

目标与完成条件：新增 `src/web/components/ModelDot.tsx` 与 `.model-dot` 样式，组件内部只调 `modelColor`；`BreakdownList` 增加可选 `showModelDot`，仅「按模型」两处传 `true`；`RequestTable` 模型列在文本前插入色点。保持 52px 行高、8 行截断、`.truncate` 的 190px 与省略号行为，色点不改变布局、不承载数值、不影响点击与筛选。对应 Spec R5、AC4 与 Plan「色点复用」。

必要依赖：T002。

修改范围：`src/web/components/ModelDot.tsx`、`BreakdownList.tsx`、`RequestTable.tsx`、`src/web/styles.css`、`src/web/App.tsx`。

实施结果：新增 `ModelDot`，内部只调 `modelColor` 并以 `backgroundColor` 输出，保证色点与图表取同一个色值字符串；`BreakdownList` 增加可选 `showModelDot`，仅「按模型」两处启用，色点置于 `.breakdown-name` 内以保留省略号与 52px 行高；`RequestTable` 模型列在文本前插入色点，`.truncate` 的 190px 与截断行为不变；新增 `.model-dot` 样式（8px 圆点、`flex-shrink: 0`、`vertical-align: middle`）。

验证：`npm run typecheck` 通过；`npm test` 11 个文件 94 项通过、1 项既存 skip；`npm run build` 通过。

提交：d636c1e

# T004 自定义模型下拉

状态：done

目标与完成条件：按确认的方案 A，把 `FilterBar` 的模型下拉改为 button + `role="listbox"` / `role="option"` 的自定义下拉，每项带 `ModelDot`；分组、对话、时间三个原生 select 保持不变。补齐键盘（Enter / Space 打开、↑↓ 移动、Enter 选中、Esc 关闭、Tab 离开）、`aria-expanded` / `aria-controls` / `aria-selected`、点击外部关闭、与 `filters.model` 受控同步，以及「当前筛选值不在选项里」的兜底项。样式沿用 `.filter-field` 的 34px 高度、8px 圆角与浅色主题变量。对应 Spec R7、AC4 与 Plan「模型下拉（方案 A）」。

必要依赖：T003。

修改范围：`src/web/components/FilterBar.tsx`、`src/web/styles.css`、`src/web/components/ModelSelect.tsx`。

实施结果：按确认的方案 A 新增 `ModelSelect`，模型下拉改为 `role="combobox"` 按钮 + 常驻 DOM 的 `role="listbox"`（关闭时 `hidden`），每个选项与当前选中值都带 `ModelDot`；补齐 Enter / Space 打开、↑↓ 移动、Enter 选中、Esc 关闭、Tab 离开、`aria-expanded` / `aria-controls` / `aria-activedescendant` / `aria-selected`、点击外部关闭，以及「当前筛选值不在选项里」的兜底项。分组、对话、时间三个原生 select 保持不变；`renderOptions` 仍服务前两者。新增 `.model-select-*` 样式，沿用 34px 高度、8px 圆角与浅色主题变量。

验证：`npm run typecheck` 通过；`npm test` 11 个文件 94 项通过、1 项既存 skip；`npm run build` 通过。DOM / 键盘行为由 T005 的 CDP 验收覆盖。

提交：07ff985

# T005 CDP 验收脚本改造

状态：done

目标与完成条件：`scripts/panel-acceptance.mjs` 的 `chartStateExpr` 改为按 `series.id`（业务键）收集颜色，AC7 的 `colorsStable` 随之按业务键比对；`readModelOptions` 与第 353 / 361 行的原生 select 交互改为自定义下拉的点击 / 键盘交互，保持「选中后仍可切换」断言不降级；新增 AC3 断言「不带筛选参数的 `/api/breakdown?dim=model` 请求数为 0」且放在脚本自身 fetch 该路径之前；新增首帧颜色稳定断言与跨视图色点一致性断言（CSS `rgb()` 与 ECharts `#hex` 归一化后比较）。对应 Spec AC1 / AC3 / AC4 与 Plan「测试策略」。

必要依赖：T004。

修改范围：`scripts/panel-acceptance.mjs`、`src/web/components/ModelSelect.tsx`。

实施结果：`chartStateExpr` 改为按 `series.id`（业务键）收集颜色，AC7 的 `colorsStable` 随之按业务键比对；`ModelSelect` 的 trigger 与 option 补 `data-model`，使 CDP 断言能按业务键读取；新增 `selectModel` helper 以自定义下拉的点击替代原生 `select.value + dispatchEvent`，`readModelOptions` 改读 `.model-select-option`；新增「无参数 dim=model 请求数为 0」断言（放在脚本自身 fetch 该路径之前）、首帧颜色稳定断言、色点跨趋势图 / 拆分 / 下拉 / 明细一致性断言（CSS `rgb()` 与 ECharts `#hex` 归一化后比较），明细色点与图表颜色在「全部模型」筛选下比对。

验证：`node --check scripts/panel-acceptance.mjs` 通过；`npm run typecheck` 通过；`npx vitest run tests/model-colors.test.ts tests/display.test.ts` 22 项通过；`npm run acceptance` 10 项全部 PASS。首轮 AC7 FAIL 的诊断：切 credit tab 前选中的模型 `credit = 0`，按 R7 被隐藏后积分趋势图走预期空态，导致读不到 y 轴；修复为在切 tab 前用「全部模型」清除模型筛选，未放宽任何断言。首轮与复跑的完整输出见本任务验证记录。

提交：2509ab1

# T006 长期文档与一致性单测

状态：done

目标与完成条件：新增 `docs/model-colors.md`（12 项显式色表、系列前缀表、保留档位与兜底规则、哈希算法冻结、色表只增不改的扩表规则、已知限制）；更新 `technical-architecture.md`（面板层配色不来自 API、删除额外全量模型查询的说明）与 `product-brief.md`（成功标准补充模型颜色长期稳定）；补一条单测解析 `docs/model-colors.md` 的色值表，与 `model-colors.ts` 的显式色表逐项比对，防止文档与代码漂移。对应 Spec AC6 与 Plan「兼容与迁移方案」。

必要依赖：T001、T002。

修改范围：`docs/model-colors.md`、`docs/technical-architecture.md`、`docs/product-brief.md`、`tests/model-colors.test.ts`。

实施结果：新增 `docs/model-colors.md`，记录 12 项显式色表、系列前缀表、保留档位与兜底规则、FNV-1a 冻结、色表只增不改的扩表规则、已知限制与变更记录；`technical-architecture.md` 的面板层说明补上「配色按业务键静态映射、不来自 API、不写数据库、不额外请求模型集合」，并链接专题文档；`product-brief.md` 成功标准补「模型颜色长期稳定」；`tests/model-colors.test.ts` 增加文档一致性单测，解析文档色值表与 `MODEL_COLOR_TABLE` 逐项比对，防止双份维护漂移。

验证：`npm run typecheck` 通过；`npx vitest run tests/model-colors.test.ts` 9 项通过（含新增文档一致性用例）；`git diff --check` 通过。

提交：399dc44

# T007 交付收尾检查

状态：done

目标与完成条件：逐项核对 Spec 的 AC1–AC6 是否满足；核对各任务状态与实施记录准确完整，并一次性回填所有已实施任务的「提交」字段；确认 `product-brief.md`、`technical-architecture.md`、`docs/model-colors.md` 与实现一致、无已知矛盾；检查 `docs/backlog/` 中与本次交付相关的条目。全量运行 `npm run typecheck`、`npm test`、`npm run build`；`npm run acceptance` 执行结果或清晰记录未执行原因。收尾提交不填本字段。对应 AGENTS.md 第 5 节。

必要依赖：T001–T006。

修改范围：`docs/delivery/model-color-binding-tasks.md`。

实施结果：逐项核对 Spec——AC1 稳定性由纯函数单测与 CDP「配色跨筛选稳定 / 首帧无变色」覆盖；AC2 确定性由色值唯一、同系列色相、跨系列可辨、哈希固化与前缀归属单测覆盖；AC3 首帧稳定由「无参数 dim=model 请求 0 次」与首帧颜色断言覆盖；AC4 跨视图一致由 CDP 色点比对覆盖；AC5 口径回归由全量单测、构建与既有交互验收项覆盖；AC6 文档由专题文档、架构 / 简报更新与一致性单测覆盖。T001–T006 状态与实施记录核对无误，提交 hash 已一次性回填。`docs/backlog/` 唯一条目「子代理积分对账」与配色无关，不改动。`technical-architecture.md`、`product-brief.md`、`docs/model-colors.md` 与实现无已知矛盾。

剩余风险：同系列浅色档在白底偏淡、每系列仅 3 个保留档位（多个同系列新模型可能撞档同色），均为 Spec 与专题文档已记录的已知限制，按用户决定暂不扩容；Vite 的 chunk 体积提示与 `refresh.test.ts` 的 1 项 skip 为既存状态，与本次交付无关。

验证：`npm run typecheck` 通过；`npm test` 11 个文件 95 项通过、1 项既存 skip；`npm run build` 通过；`npm run acceptance` 10 项全部 PASS（含新增 3 项配色断言）；`git diff --check` 通过。
