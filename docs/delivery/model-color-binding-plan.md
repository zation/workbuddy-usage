# 模型固定基础色 Plan

## 现状分析

Spec（`model-color-binding-spec.md`）已确认，业务规则 R1–R7、验收标准 AC1–AC6 与「同系列颜色相近」的决策不在本 Plan 重复。本 Plan 只讨论怎么落地，以及执行上会撞到什么。

代码现状逐项核对：

- `src/web/display.ts` 的 `modelColorIndex(rows)` 按展示名排序产生色位索引；`tests/display.test.ts` 有 3 个对应用例（排序无关、同名兜底、两 tab 共享索引）。
- `src/web/components/TrendChart.tsx`：`colorIndex?: Record<string, number>` 是可选 prop，`colorSlot = colorIndex?.[modelKey] ?? index`，取 `PALETTE[colorSlot % PALETTE.length]` 作为 `itemStyle.color`；顶层另有 `color: PALETTE`；series 未设 `id`，`name` 用展示名。
- `src/web/palette.ts` 导出 12 色 `MODEL_COLORS`；`tests/palette.test.ts` 断言长度 ≥ 12、色值不重复、格式为 `#rrggbb`，并用 `readFileSync` 断言 `TrendChart` 内出现 `MODEL_COLORS`，目的是防止组件内另起一套本地色板。
- `src/web/App.tsx` 第 84 行额外发起 `GET /api/breakdown?dim=model`（不带任何筛选），第 118 行据此算 `modelColors` 并传给两个 `TrendChart`。删掉这个顶层 `useQuery` 调用不影响其它 hooks 的顺序与数量约束（其余仍是顶层无条件调用）。0 值隐藏走 `modelOptions` + `visibleModelKeys`，与配色集合互不混用。
- `src/web/components/BreakdownList.tsx` 被按分组、按对话、按模型三处复用，没有维度参数；`.breakdown-line` 是 flex，`.breakdown-name` 带省略号，行高由 `--breakdown-row-height: 52px` 固定。
- `src/web/components/RequestTable.tsx` 模型列是 `<td className="truncate" title={row.model}>`，`.truncate` 有 `max-width: 190px; overflow: hidden; text-overflow: ellipsis`。
- `src/web/components/FilterBar.tsx` 的三个下拉都是原生 `<select><option>`，`renderOptions` 为三者共用；模型下拉 id 为 `filter-model`。
- `scripts/panel-acceptance.mjs` 的 `readModelOptions`（第 344 行）直接读 `select.options`，并在第 353、361 行用 `select.value = ...; select.dispatchEvent(new Event('change'))` 改写筛选；`chartStateExpr`（第 123 行）用 `s.name`（展示名）作 key 收集系列颜色；第 340 行脚本自身 fetch 了一次不带参数的 `/api/breakdown?dim=model`。
- `docs/technical-architecture.md` 第 21 行规定「面板层只渲染 API 返回值，不自行求和或换算」。颜色是纯展示派生、不参与任何聚合，加入面板层不违反该原则，但需在架构文档中说明配色不来自 API、也不写回派生库。
- 现有交互验收没有 DOM 测试框架，纯逻辑靠 Vitest，DOM / ECharts 靠 CDP 脚本。本交付不引入新依赖。

## 技术方案

### 色值与档位的单一来源

新建 `src/web/model-colors.ts`，集中放四样东西：系列前缀表、显式色表、各系列的保留档位、全局兜底色板，并导出唯一入口 `modelColor(modelKey: string): string`。色值全部写成**十六进制字面量**，不在运行时做 HSL/明度换算——浮点与舍入会让同一模型在不同浏览器得到不同色值，直接破坏「跨视图逐值一致」与长期识别。

删除 `src/web/palette.ts`（连同 `tests/palette.test.ts` 重写为 `tests/model-colors.test.ts`），避免「旧 12 色色板」与「新系列色表」两套概念并存。`tests/palette.test.ts` 里「防止组件内联本地色板」的意图迁移到新测试：读组件源码断言不出现独立的色值数组，且所有取色都经过 `modelColor`。

系列前缀按**长度降序最长匹配**：`minimax` / `deepseek` / `kimi` / `mimo` / `step` / `glm` / `hy`。`hy` 是短前缀，命中 `hy3`、`hy4`、`hy4-*`；`mimo` 与 `minimax` 靠最长匹配区分。前缀表是静态常量，不解析展示名、厂商或模型语义。

每个系列持有一组静态档位色值，其中若干档被显式色表占用，其余标记为该系列的「保留档位」。显式模型直接查表；新模型命中系列时用稳定哈希从保留档位里取一档；未命中系列时用稳定哈希从全局兜底色板取色。保留档位清单由静态色表定义，不依赖当前数据集合，因此 R3 的确定性成立。

哈希用 FNV-1a 32 位（逐 `charCodeAt` + `Math.imul`，结果 `>>> 0`），零依赖、跨环境一致。**算法上线后即冻结**：改动会让所有走兜底的模型集体换色，与本次需求目标相反；`docs/model-colors.md` 需写明这一点，并用单测固化若干标识的哈希输出，防止无意改动。

### 趋势图与首帧稳定

`TrendChart` 删除 `colorIndex` prop，系列颜色直接取 `modelColor(modelKey)`；给每个 series 设 `id: modelKey`，让验收脚本可以按业务键而不是展示名读颜色。删除顶层 `color: PALETTE`（或改为新色表派生值），避免 ECharts 在未显式着色的元素上回落旧色板。legend 仍跟随 series 颜色，无需改动 `legend` 配置。

同系列相邻堆叠块用 `borderColor: '#fff'`、`borderWidth: 1` 的细白色描边区分边界；描边不改变色相与档位值，也不影响图例（图例色点仍取 series 颜色）。`emphasis.focus: 'series'` 保持不变。

`App` 删除 `modelPalette` 查询、`modelPaletteRows`、`modelColors` 与两处 `colorIndex` 传参。颜色从此不需要等待任何异步结果，首帧即最终值。`visibleTimeseries` 与 `visibleModels` 仍由 `modelOptions` 驱动，0 值隐藏口径不变。

### 色点复用

新增 `src/web/components/ModelDot.tsx`，接收 `modelKey`，内部只调 `modelColor`，保证趋势图、列表、下拉、明细取到同一个字符串色值。样式为 `.model-dot` 小实心圆点，`flex-shrink: 0`，不带数值、不响应点击。

- `BreakdownList` 增加可选 `showModelDot?: boolean`，仅「按模型」两处传 `true`；色点放在 `.breakdown-name` 之前、`.breakdown-line` 内，不改变 52px 行高与 8 行截断。
- `RequestTable` 模型列在文本前插入色点；`.truncate` 的 `max-width` / `overflow` / 省略号保持不变，色点用 `inline-block` 参与行内布局，需在 CDP 中核对长模型名不被提前裁掉。
- `FilterBar` 模型下拉见下节。

### 模型下拉（本交付唯一有实质分歧的点）

原生 `<option>` 不能可靠地渲染「独立彩色色点 + 保持深色可读文字」：给 `option` 设 `style.color` 会把整行文字染成该颜色，`#60a5fa` 一类浅色档在白底上对比度不足；`background-color` 在 Windows 原生下拉里常被忽略；`option` 内也不能放 `<span>` 做局部着色。因此严格满足 AC4「模型下拉项色点」只有三条路：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A（推荐）自定义 listbox | 模型下拉换成 button + `role="listbox"` / `role="option"`，每项带 `ModelDot`；另两个下拉保持原生 | 新增键盘（Enter/Space 打开、↑↓、Esc、Tab）、`aria-expanded` / `aria-controls` / `aria-selected`、点击外部关闭、当前值兜底；**`scripts/panel-acceptance.mjs` 第 344–372 行的 4 处原生 select 交互必须重写** |
| B 影子 select | 保留 `#filter-model` 原生 select 做表单语义与脚本入口（视觉隐藏、`tabIndex=-1`、`aria-hidden`），旁边渲染自定义色点下拉并同步 value | 脚本基本不用改，但 DOM 里两个控件并存，焦点与 ARIA 需谨慎，维护成本不比 A 低 |
| C 降档 | 保留原生 select，只在框外显示「当前选中模型」的色点，下拉项不加色点 | 零风险、零脚本改动，但需修订 Spec R5 与 AC4，放弃「下拉项带色点」 |

推荐 A：需求已明确要求下拉项带色点，A 的 DOM 最干净，代价是一次性的脚本改造；B 的隐藏控件会给后续维护埋坑。若不愿承担脚本改造，选 C 并同步改 Spec。此点需在本 Plan 确认时拍板。

### 样式与对比度

新增 `.model-dot` 与（选 A 时）自定义下拉样式，沿用现有浅色主题 CSS 变量与 `.filter-field` 的 34px 高度、8px 圆角，保证三个筛选控件视觉一致。文字颜色始终是深色主题变量，只有色点用模型色，避免浅色档文字不可读。

## 影响范围

**新增**：`src/web/model-colors.ts`、`src/web/components/ModelDot.tsx`（若选 A 另增自定义下拉组件，可放在 `FilterBar.tsx` 内不单独建文件）、`tests/model-colors.test.ts`、`docs/model-colors.md`。

**修改**：`src/web/App.tsx`、`src/web/display.ts`（删除 `modelColorIndex`）、`src/web/components/TrendChart.tsx`、`BreakdownList.tsx`、`RequestTable.tsx`、`FilterBar.tsx`、`src/web/styles.css`、`scripts/panel-acceptance.mjs`、`tests/display.test.ts`、`docs/technical-architecture.md`、`docs/product-brief.md`。

**删除**：`src/web/palette.ts`、`tests/palette.test.ts`。

**不改**：`server/` 全部、`src/etl/` 全部、`src/shared/types.ts`、五个 API 端点、派生库结构与 `SCHEMA_VERSION`、`useQuery`、0 值隐藏与列表截断逻辑、依赖清单、`~/.workbuddy` 下任何原始数据。

## 数据与接口变化

无。API 请求与响应结构、参数、筛选口径全部不变；颜色不入库、不落配置、不进 API，也没有 `schema_version` 递增或删库重建。唯一的网络变化是**少一次** `GET /api/breakdown?dim=model`。

## 兼容与迁移方案

- **色表只增不改**：新增模型只允许追加条目，不得重排或改色；若确实要改某个已上线模型的颜色，需在 `docs/model-colors.md` 记录变更原因与生效版本，因为它会破坏该模型的长期识别。
- **哈希冻结**：FNV-1a 参数与取模方式写入长期文档并用单测固定输出；改动等同让所有兜底模型换色。
- **文档一致性**：`docs/model-colors.md` 是色表的文档副本，与 `model-colors.ts` 存在漂移风险，加一条单测解析文档表格与代码常量逐项比对（沿用项目已有的 `readFileSync` 源码断言方式，不引入依赖）。
- **回滚**：`git revert` 相关提交即可，无需 `npm install`、无需删除 `.data/index.db`、无需清理外部状态。

## 顺序约束

1. 先落 `model-colors.ts` 与纯函数单测，再改组件；否则组件引用不存在的模块，`typecheck` 会失败。
2. `TrendChart` 删除 `colorIndex` prop 与 `App` 删除 `modelPalette` / `modelColors` 必须同批完成，新旧 prop 并存会让类型检查通过但留下死代码。
3. 下拉方案确认前不动 `FilterBar` 与验收脚本的模型选择部分，避免按错误方案返工。
4. 删除 `palette.ts` 前确认无残留引用，特别留意 `tests/palette.test.ts` 里对 `TrendChart` 源码字符串的断言。
5. 长期文档在功能验收通过后同步，避免先写事实后改实现。

## 测试策略

- **类型检查是独立必需项**：`npm run typecheck`，不得由 lint / 构建 / 测试代替。
- **Vitest**（`npm test`）：`tests/model-colors.test.ts` 覆盖——12 项色值唯一且格式合法、同系列色相相近且系列内各档互不相同、不同系列可辨、前缀最长匹配（`mimo` vs `minimax`、`hy` 命中 `hy4-preview-f`、`kimi-k4` 落到绿色系）、未知前缀走全局兜底、同一标识重复计算一致、哈希输出固化；`tests/display.test.ts` 删除 `modelColorIndex` 的 3 个用例；`tests/palette.test.ts` 的意图迁移到新测试（组件不得内联色值数组、必须经过 `modelColor`）。
- **文档一致性单测**：解析 `docs/model-colors.md` 的色值表，与 `model-colors.ts` 常量逐项比对。
- **构建**：`npm run build`（含 `tsc -p tsconfig.build.json` 与 `vite build`）。
- **CDP 交互验收**（`npm run acceptance`）：
  - `chartStateExpr` 改为按 `series.id`（业务键）收集颜色，AC7 的 `colorsStable` 随之按业务键比对，避免展示名变化干扰断言。
  - 新增 AC3 断言：无参数 `/api/breakdown?dim=model` 请求数为 0；**注意脚本第 340 行自己会 fetch 一次同路径**，该断言必须放在这次 fetch 之前，或显式排除脚本自身请求，否则会误判。
  - 新增首帧断言：图表首次渲染后立刻读一次系列颜色，等待一段时间再读一次比对，验证无中途变色。
  - 新增跨视图一致性断言：取 `ModelDot` 的 computed `background-color` 与图表 series 颜色比对；CSS 返回 `rgb(...)`、ECharts 返回 `#rrggbb`，**必须做格式归一化**再比较。
  - 若选方案 A，`readModelOptions` 与第 353 / 361 行的 `select.value` + `dispatchEvent('change')` 改为自定义下拉的点击 / 键盘交互，并重新核对「选中后仍可切换」断言。
  - 回归：v1.0.0 与 `usage-panel-polish` 既有验收项继续通过，重点确认 0 值隐藏、tab 状态、列表截断、数值单位不变。
- **只读验证**：外部数据只读边界不变，无需重复比对 mtime。

## 关键取舍

| 选择 | 理由 | 代价 |
| --- | --- | --- |
| 色值全部用静态字面量，不运行时算 HSL | 保证跨浏览器逐值一致，跨视图色点才能与图表对齐 | 档位是离散数组，新增档要手工补色 |
| 新建 `model-colors.ts` 并删除 `palette.ts` | 避免两套色板并存，函数名直接表达「按模型取色」 | 多一次文件增删与测试迁移 |
| 哈希只用于「色表外」标识 | 已知模型颜色完全可控，兜底又能自动覆盖未来新模型 | 算法必须冻结，改一次等价于全部兜底模型换色 |
| series 加 `id: modelKey` | 验收脚本可以按业务键读颜色，与展示名解耦 | ECharts option 多一个字段 |
| 白色细描边而非拉开色相 | 满足「同系列颜色相近」的同时保证堆叠块可分辨 | 浅色档在淡化态下仍偏淡，靠图例文字兜底 |
| 自定义 listbox（方案 A） | 唯一能严格满足「下拉项带色点」的干净做法 | 验收脚本需同步改造，键盘 / ARIA 需补齐 |

## 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
| --- | --- | --- |
| 自定义下拉破坏 CDP 脚本的原生 select 断言 | 验收脚本大面积 FAIL，误判为功能回归 | 方案确认后同批改脚本并复跑；脚本改造留在新测试里，不降低断言强度 |
| 同系列五档蓝色在堆叠图里相邻难分 | 图表可读性下降 | 白色 1px 描边 + CDP 截图人工核对；不靠拉开色相解决，避免违背需求 |
| 浅色档 `#60a5fa` 在白底偏淡 | 色点 / 色块辨识度低 | 色点保留实心，文字仍用深色变量；如仍不足，在 Spec 确认阶段调整该档色值 |
| 哈希或前缀表被无意改动 | 兜底模型集体换色，长期识别失效 | 固化输出单测 + 文档写明冻结规则 |
| 色表与文档漂移 | 文档失真 | 文档一致性单测 |
| `rgb()` 与 `#rrggbb` 格式不一致 | 跨视图一致性断言误判 FAIL | 验收脚本归一化后再比较 |
| 删除 `palette.ts` 后残留引用 | 构建失败 | `typecheck` + 全仓搜索 `MODEL_COLORS` / `palette` |
| 脚本自身 fetch 污染网络断言 | AC3 误判 | 断言前置或排除该请求 |

**回滚**：`git revert` 本交付提交 → `npm run typecheck && npm test && npm run build` 验证。无外部状态、无派生库迁移。

## 执行上的问题与待决点

供本 Plan 确认时逐项拍板：

1. **下拉方案三选一（A / B / C）**——唯一会显著改变工作量与验收脚本的点。推荐 A；若选 C 需同步修订 Spec R5 / AC4。
2. **hunyuan 五档蓝色的可分辨性**：描边能分开边界，但颜色本身仍相近（这正是需求要的效果）。是否接受，或把阶梯拉得更散一点？
3. **保留档位容量**：hunyuan 显式占 5 档后只剩 3 个保留档位，未来多个 `hy*` 新模型可能同档同色（Spec 已记为已知限制）。是否扩到更多档位？扩档会牺牲可分辨性，需要取舍。
4. **验收脚本两处陷阱**：script 自身 fetch 污染 AC3 网络断言、CSS `rgb()` 与 ECharts hex 不一致——已在上文给出处理方式，确认按此执行即可。
5. **`palette.ts` 删除 vs 保留**：推荐删除以避免两套色板；若希望改动更小，可保留文件名、只替换内容并保留 `MODEL_COLORS` 导出名。
6. **色表色值与 `docs/model-colors.md` 双份维护**：推荐加文档一致性单测，确认是否纳入验收范围。

除第 1 项外，执行路径清晰：无后端改动、无数据迁移、无依赖增删、无 `schema_version` 递增，回滚只需 `git revert`。
