# Hover 模型聚焦与交互验收框架化 Tasks

本文件按 [hover-model-focus-plan.md](./hover-model-focus-plan.md) 的技术方案拆分；业务规则与验收标准见 [hover-model-focus-spec.md](./hover-model-focus-spec.md)。任务编号稳定，依赖关系决定实际执行顺序。

**前置提交已完成**：数据库命名重构（`database.db` / `database.ts` / `openDatabase` / `closeDatabase` / `databasePath`）、可选环境变量 `DATABASE_PATH` 与全项目术语统一，已在 `6afb3b8` 落地并通过 `npm run typecheck`、`npm test`、`npm run build`。本文件不重复这部分工作，对应 Spec 已确认决策与 Plan「命名与术语统一」一节。

## 执行顺序与依赖

按 Plan「顺序约束」执行：覆盖清单先固化、再逐项重写用例；聚焦实现先定 0.4 常量与业务键判定，再做四处渲染与状态清除，最后接 e2e 断言；旧脚本在对照完成前不得删除；长期文档在功能与验收通过后同步。运行时顺序固定为「生成样本 → 构建 → 启动服务（首次刷新读样本、按 `DATABASE_PATH` 建临时数据库）→ 执行用例 → 清理」，不可颠倒。

依赖关系：T001 与 T005 可先行；T001 + T002 + T003 → T004（其中 T002 → T003）；T005 → T006、T007；T004 + T006 + T007 → T008；T004 + T008 → T009；T009 → T010；T001–T010 → T011。

## 任务

# T001 固化 26 项验收覆盖清单

状态：done

目标与完成条件：从 `scripts/panel-acceptance.mjs` 的 `check()` 调用逐项提取覆盖项名称、判定条件与阈值（当前 26 项覆盖；AC14 的正常 / skip 分支属同一项），形成迁移对照基线。按 Spec R8 与 AC10，对照的是覆盖项与判定标准，不是旧脚本的实现方式或数值结果；清单逐项可核对，并作为 T004 实施记录的对照来源，不新建独立验证文档。

修改范围：`scripts/panel-acceptance.mjs`（只读）。

实施结果：按脚本顺序提取出 26 项覆盖（语句级 `check()` 共 26 处，与 `AC14` 的 SKIP 分支合并计为一项），作为 T004 的对照基线。下表只记录**当时代码的判定条件与阈值**，不作为新用例的写法模板；新用例的判定方式与期望值来源按 Plan AD-4 / AD-5 重新设计。

| # | 覆盖项 | 判定条件与阈值 |
| --- | --- | --- |
| 1 | 配色无全量模型请求 | 资源条目中不存在查询串恰为 `?dim=model` 的 `/api/breakdown` 请求，计数为 0 |
| 2 | 无外部域名请求 | 全部资源请求的 `hostname` 等于 `location.hostname`，异常计数为 0 |
| 3 | tab 与 ARIA 关联 | 2 个 `[role=tab]`，第 1 个 `aria-selected=true`、第 2 个 `false`，两者 `aria-controls` 目标均存在，激活 tab 为第 1 个；2 个 `[role=tabpanel]` 均有 `aria-labelledby`；恰好 1 个 `hidden` 且 id 等于未激活 tab 的 `controls`；`canvas` 计数为 1 |
| 4 | 明细折叠与懒加载 | 折叠时 `/api/requests` 请求数 0，所有 `.table-toggle` 的 `aria-expanded=false`；点击后请求数 1 且查询串含 `sort=startedAt&order=desc`，`aria-expanded=true`，`tbody tr` 行数 >0，`.table-body .table-wrap` 的 `max-height` 为 440px，存在 `th[aria-sort=descending]` |
| 5 | 拆分列表行数与滚动 | 3 个 `.panel.breakdown`；每行 shown ≤8；行高去重后仅 1 种；`scrollHeight ≤ clientHeight + 1`；面板 `项数 ≥ shown` |
| 6 | token 单位与中文单位 | 「合计 Token / 输入 / 输出 / 缓存命中」匹配 `^-?[\d,]+(\.\d)?[KMB]?$`，请求数匹配 `^\d[\d,]*$`；`.metric-value / .breakdown-value / .table-body td` 拼接文本不含「万」「亿」；趋势图 y 轴刻度不含「万 / 亿 / k」且至少一个以 K/M/B 结尾；tooltip 对 1000 / 10000 / 1000000 的输出不含「万 / 亿 / ERROR」 |
| 7 | 缓存命中率 | 卡片 suffix 等于 `(cacheReadTokens / inputTokens × 100).toFixed(1)%`；分母为 0 时 suffix 为 `—` |
| 8 | 列表点击与下拉同一筛选 | 点击首个分组行后 `#filter-group` 的 `dataset.value` 等于该行 key；下拉选择同一 key 后值相同；两条路径最近一次 `/api/summary` 请求 URL 完全相等且非空 |
| 9 | 首帧颜色即最终值 | 间隔 1.5s 两次读取的 series 颜色 map 完全相同（比对模型数 >0）；切到「今天」后同名模型的颜色不变 |
| 10 | 色点跨视图一致 | 「按模型」首行 `.model-dot`、模型下拉选项色点均等于该模型图表颜色（归一化为 rgb）；`#filter-model` 触发按钮色点等于当前选中模型颜色；明细表首行 `.model-dot` 等于该行模型颜色 |
| 11 | 0 值隐藏与下拉可切换 | token 维度 `totalTokens==0` 的模型不在模型下拉选项；积分维度 `credit==0` 的模型（当前选中值除外）不在选项；选中首项后选项数量不变且值回显；切到另一项后值变化；共享模型颜色不变（比对数 >0）；积分图 y 轴与 tooltip 不含 `k` |
| 12 | 分组下拉与聚合一致 | 下拉选项（去空值）排序后等于 `/api/breakdown?dim=group` 的 key 排序；无 `…/WorkBuddy/yyyy-MM-dd-HH-mm-ss` 形态条目；「默认」在下拉与接口中同时存在或同时不存在 |
| 13 | 空范围「默认」不占位 | 选一个无数据的单日区间：接口 rows 长度 0，下拉选项恰为 `['']` |
| 14 | 「默认」筛选跨端点一致 | 切到「默认」后回显「默认」；最近 summary 请求 URL 含编码后的键；group 维度 rows 仅 1 行且 key 为「默认」；requests 的 group 全部匹配自动目录正则；requests 的 session / model 集合等于对应维度 rows 的 key 排序；timeseries 的 `totalTokens` 合计等于 `summary.token.totalTokens` |
| 15 | 下拉 ARIA 与键盘 | 3 个维度触发器为 `role=combobox`、`aria-haspopup=listbox`、关闭态 `aria-expanded=false`、`aria-controls` 目标存在、`aria-activedescendant` 为空、容器内 `aria-selected=true` 的选项恰好 1 个；ArrowDown 展开并给出 activedescendant，再 ArrowDown 后变化，Enter 关闭且值等于该项，ArrowDown + Escape 关闭，ArrowDown + 外部 pointerdown 关闭。时间区 4 个 `data-quick` 依次为 today / threeDays / sevenDays / thirtyDays，`aria-pressed` 仅为 true/false，`.filter-time .select` 计数 0，`[role=group]` 的 `aria-label` 为「时间范围」，`.date-range input[type=date]` 计数 2 |
| 16 | 两图 tooltip 过滤 0 值 | formatter 输出含日期与两个非 0 模型、不含 0 值模型、降序；全 0 日输出含日期与「无数据」、不含任何模型 |
| 17 | 时间区默认近 3 天 | 4 个快捷按钮顺序一致，`aria-pressed` 命中 threeDays，from 为 today−2、to 为 today，时间区内 select 计数 0 |
| 18 | 快捷按钮回填与手改 | 四个预设点击后 `aria-pressed` 等于该键、from / to 正确、最近 summary 请求 URL 含 from 与 to；手改 from 命中 threeDays 区间时高亮回填；改为非预设（today−3）后高亮为空且 from / to 正确 |
| 19 | 非法区间与清空回弹 | from 晚于 to 时 `.filter-error` 为「起始日期不能晚于结束日期」、from 保持生效值、此后 summary 请求计数 0；清空 to 后回弹为生效值 |
| 20 | 补轴与近 7 天 7 格 | `/api/timeseries` 响应不含 `days` 键；近 7 天时 x 轴类目 7 个、首个为 today−6、末个为 today |
| 21 | 100 / 101 天边界 | 100 天区间类目 100 个；改到第 101 天时前端 error 为「时间跨度不能超过 100 天」、此后 summary 请求计数 0；`GET /api/summary?from=today−100&to=today` 返回 400 且 error 同文案；不带日期返回 200 且 `totalTokens>0`；点回「7 天」后 error 为空、类目 7 个 |
| 22 | 比率折线与隐藏 | 有 ratios 时 y 轴 2 个、第 2 个 `name` 为 `×`、折线 1 条且 `type=line` / `yAxisIndex=1` / `connectNulls=false` / `data` 长度等于类目数、图例不含「价格比率」、无 `valueFormatter`；无 ratios 时 y 轴 1 个、无折线、无 `valueFormatter` |
| 23 | 比率 tooltip | tooltip 含「DeepSeek 费用比率：4.16×」与柱子 `1.2K`、不含 0 值模型、不含 `ERROR`；区间无 DS 数据时记 SKIP |
| 24 | 非 DS 模型隐藏折线 | 选中非 DS 模型后 y 轴 1 个、无折线、`document.body.innerText` 不含「DeepSeek 费用比率」；无候选时记 SKIP |
| 25 | 分组条分段 | 段数等于 `split=model` 中主指标 >0 的段数且 >0；段色逐个等于趋势图 series 颜色；段宽之和与 `tokenShare × 条宽` 相差 ≤1.5px；其它两个列表 `.breakdown-segment` 计数 0、`.breakdown-fill` 计数 >0 |
| 26 | 分组明细提示 | hover 首行后提示打开、key 等于该行汇总 key、模型行等于期望段展示名序列；移出后关闭；键盘 focus 后打开且内容一致；`pointer-events` 为 `none`；行高与未 hover 时相同 |

验证：`grep -c "check(" scripts/panel-acceptance.mjs` 为 28 处，其中函数定义 1 处、调用 27 处；调用里 AC14 的 if / else 两个分支属同一覆盖项，故覆盖项共 26 项，与上表 26 行逐项对齐。T001 全程只读，`git status --short` 无输出。

提交：e673a5f

# T002 Playwright 运行器与验收入口骨架

状态：done

目标与完成条件：按 Plan AD-1、AD-2、AD-8 建立配置与运行器隔离，`npm run acceptance` 串起样本生成、构建、`webServer` 启停、用例执行与清理；用例目录不被 Vitest 收集、被 typecheck 覆盖；失败保留 trace 与截图。完成条件：单命令能启动服务并跑到用例（可先用一个最小用例验证启停与清理），满足 AC9 的框架化要求与 AC11 的一条命令要求。本任务只建配置骨架，验收入口的最终指向与旧脚本摘除统一归 T009。

修改范围：`package.json`、`playwright.config.ts`、`tsconfig.json`。

实施结果：`@playwright/test` 1.65.1 以精确版本加入 devDependencies，`dependencies` 未变。`playwright.config.ts`：`testDir: tests/e2e`、`testMatch: **/*.spec.ts`、`workers: 1`、`fullyParallel: false`、`reuseExistingServer: false`、视口 1400×1100、`deviceScaleFactor: 1`（供 canvas 像素断言）、`trace: retain-on-failure`、`screenshot: only-on-failure`、`outputDir: .data/e2e-results`；`webServer` 以 `npm start` 起单端口，`PORT=4630`（避开日常 4620）、`DATABASE_PATH=.data/e2e/database.db`。`tsconfig.json` 的 include 补 `playwright.config.ts`，`tests` 原已在列，因此 e2e 用例与配置都被独立类型检查覆盖。`npm run acceptance` 指向新增的 `scripts/e2e-run.mjs`：按「生成样本 → 构建 → playwright test → 清理」顺序编排，`finally` 保证失败也清理。最小用例 `tests/e2e/panel.spec.ts` 断言标题、2 个 tab、6 个指标卡、4 个快捷区间与无 pageerror，并从 `src/web/filters.ts` 导入 `QUICK_PRESETS`，同时验证 Playwright 能直接加载仓库内的 `.ts` 源码。

必要的问题与决策：Plan AD-8 原定用 `globalTeardown` 清理 `.data/e2e/`，实测不成立——teardown 执行时 `/api/health` 仍返回 200，webServer 尚未回收，服务持有 sqlite 文件，Windows 下删除被占用文件必然失败（重试 5 次均失败）。改为入口脚本在 Playwright 进程退出后清理；Plan AD-8 与「影响范围」已按实际实现同步。为此新增 `scripts/e2e-run.mjs`（原「修改范围」未列，属运行器接线，不是需求变更）。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 163 passed / 1 skipped，`tests/e2e/*.spec.ts` 未被 Vitest 收集。
- `npm run acceptance`：退出码 0，输出顺序为样本目录就绪 → 构建 → `面板监听 http://127.0.0.1:4630` → `1 passed`；结束后 `.data/e2e/` 已删除，`.data/e2e-results/` 仅留 `.last-run.json`。
- 前置：`node_modules/@playwright/test` 1.65.1 已装；Chromium 二进制经 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright` 下载成功（默认 CDN 在本机不可达，处理方式写 T010）。验收命令要求 Node 24 在 PATH 首位，本次以 `PATH=/e/Software/nodejs:$PATH` 调用。

提交：6838079

# T003 固定样本与期望值生成

状态：done

目标与完成条件：按 Plan AD-5 与 Spec AC12 建立临时 `WORKBUDDY_HOME`、固定期望数据、浏览器时间冻结与样本自检；`DATABASE_PATH` 指向同一临时目录下的数据库。样本覆盖 AD-5 列出的场景，重复运行结果一致，运行结束临时目录与数据库被清理，运行配置中不含真实 `~/.workbuddy` 路径。

必要依赖：T002。

修改范围：`scripts/e2e-fixture.mjs`、`tests/e2e/`。

实施结果：`scripts/e2e-fixture.mjs` 每次先清空 `.data/e2e/`，再由 `tests/e2e/sample.ts` 的 `buildSampleHome()` 写出临时样本（`workbuddy.db` + `projects/**/*.jsonl`），`webServer` 以 `WORKBUDDY_HOME=.data/e2e/home`、`DATABASE_PATH=.data/e2e/database.db` 启动，配置中不含真实 `~/.workbuddy` 路径。样本规模：11 个会话、10 个分组（含 `…/WorkBuddy/2026-11-13-09-00-00` 自动目录 → 虚拟键「默认」）、5 个模型、16 条请求（含 1 条子代理），日期为 11-10、11-12、11-13、11-14。场景覆盖：11-11 为全 0 日；11-12 与 11-10 为单模型日；alpha 行 `glm-5.2` 30 token / 4730 = 0.63%，是极窄段；`kimi-k3.1-pro` 的 `totalTokens` 为 0、`mimo-v2.6-pro` 的 `credit` 为 0，分别覆盖两个 tab 的 0 值隐藏；缓存命中 1800 / 5208 = 34.6%；价格比率 11-10 为 1.25×、11-12 为 1.76×、11-13 为 4.09×。浏览器时间以 `page.clock.setFixedTime(2026-11-14T04:00Z)` 冻结在基准日北京时间 12:00，只固定 `Date.now`，不接管定时器。`tests/e2e/expectations.ts` 从样本定义确定性推出各区间期望（合计、格式化文本、模型/分组/会话序列、每日行、0 值可见集合、比率），`tests/e2e/panel-page.ts` 集中封装定位器与交互，`tests/e2e/sample.spec.ts` 做样本自检：冻结时间落在基准日、样本 `workbuddy.db` 存在、12 个 jsonl、默认区间 6510 token / 15 请求 / 5 模型、`/api/summary` 与 `/api/timeseries` 逐字段等于期望。

必要的问题与决策：期望值不落生成物 JSON，改为「样本定义 + 纯函数推出」的模块，避免生成文件与用例类型、快照不同步；比率沿用 `src/shared` 的 `wbCost` / `officialCost` 同口径计算，公式正确性由既有 `price-ratio` 单测锁定，用例只断言可见文本。样本刻意让每个分组的 token 与 credit 都不同值，消除 top-8 截断处的并列歧义。

验证：
- `npm run typecheck`：退出码 0。
- `npm run acceptance`：退出码 0，2 passed；服务日志为「扫描 12 个文件，变更 12 个，写入 16 条请求，补挂 16 条积分」，与样本定义一致；结束后 `.data/e2e/` 已清理。
- 期望值与接口交叉核对：`/api/summary` 的 token / credit / 请求数 / 会话数与 `/api/timeseries` 的日期集合、比率文本均相等（由 `sample.spec.ts` 断言，断言失败即样本漂移）。

提交：a2ba544

# T004 迁移既有 26 项覆盖为可见行为用例

状态：done

目标与完成条件：按 Plan AD-4、AD-9 与 Spec R8、AC10 逐项重写用例：断言 DOM 文本、计算样式、几何、tooltip 浮层与网络请求等用户可见结果，不读 ECharts 实例、不调用 option / formatter，格式化与刻度逻辑留在既有 Vitest 单测。逐项对照记录写进本任务实施记录，全部 PASS、退出码 0，无删除覆盖、跳过断言或放宽标准。

必要依赖：T001、T002、T003。

修改范围：`tests/e2e/`。

实施结果：26 项覆盖按验收主题重写为 27 条框架用例（26 项覆盖 + 首屏 smoke + 样本自检），分布于 `tests/e2e/structure.spec.ts`（4）、`filters.spec.ts`（8）、`metrics.spec.ts`（5）、`trend.spec.ts`（6）、`breakdown.spec.ts`（2）。对照关系（基线序号见 T001 表）：

| # | 新用例 | 判定方式 | 结果 |
| --- | --- | --- | --- |
| 1 | structure「不存在配色专用的全量模型请求」 | 页面生命周期内全部请求中，没有只带 `dim=model` 的 `/api/breakdown` | PASS |
| 2 | structure「也不产生外部域名请求」 | 全部请求 hostname 为 `127.0.0.1` | PASS |
| 3 | structure「两个 tab、默认激活 Token、aria 关联与单图表渲染」 | tab / tabpanel 属性与 `aria-controls` 指向、隐藏面板对应、`canvas` 计数 1 | PASS |
| 4 | structure「明细默认折叠且不请求，展开后按时间降序并表内滚动」 | 折叠时无 `/api/requests`；展开后 1 次请求含 `sort=startedAt&order=desc`；15 行；`max-height: 440px`；`aria-sort=descending` | PASS |
| 5 | structure「拆分列表最多 8 行、行高一致、无内部滚动且项数为全量」 | 3 个面板逐项核对行数 ≤8、行高单值、`scrollHeight ≤ clientHeight+1`、项数 10 ≥ shown 8 | PASS |
| 6 | metrics「token 使用 K/M/B、页面与 tooltip 无中文单位」 | 指标卡数值正则、请求数整数、页面无「万 / 亿」、tooltip 柱子行按 K/M/B 且至少有单位缩写（比率行单列） | PASS |
| 7 | metrics「缓存命中卡显示命中率，与样本手算一致」 | 卡片 suffix 等于样本手算 34.6%（1800 / 5208） | PASS |
| 8 | filters「列表点击与下拉框写入同一份筛选」 | 点击分组行与下拉选择同一键后，最近一次 summary 请求 URL 完全相等 | PASS |
| 9 | metrics「拆分色段首帧即最终色，重复读取与跨筛选都不变色」 | 首帧段色等于模型固定色；1.5s 后与切换 7 天再回 3 天后不变 | PASS |
| 10 | metrics「色点跨趋势图、拆分、下拉与明细一致」 | 按模型色点、下拉选项色点、分组段色、明细色点、canvas 柱像素、筛选钮色点六处同色 | PASS |
| 11 | metrics「0 值隐藏、下拉可切换、积分刻度无 k」 | 两个 tab 的模型选项集合等于可见模型（kimi / mimo 各自隐藏）、选中后仍可切换、积分两位小数且无 K/M/B 缩写 | PASS |
| 12 | filters「分组下拉无日期目录条目且与聚合结果一致」 | 选项集合等于 `/api/breakdown?dim=group` 的键集合、无自动目录条目、「默认」两侧同时存在 | PASS |
| 13 | filters「空范围内「默认」不占位」 | 空区间下拉仅空值项、接口 rows 为空 | PASS |
| 14 | filters「选中「默认」后各视图只含自动分组数据」 | 分组列表 1 行「默认」、合计 500、模型 / 会话下拉各剩 1 项、趋势图 tooltip 仅 `Hy4：500`、明细 1 行且分组为「默认」 | PASS |
| 15 | filters「三个维度下拉 ARIA 一致…」 | 三处 `role / haspopup / expanded / controls / activedescendant / selected`；ArrowDown → ArrowDown → Enter 选中、Escape 与外部点击关闭；时间区四按钮 + 两日期框 | PASS |
| 16 | trend「两张趋势图 tooltip 过滤 0 值并保留日期与「无数据」」 | 两个 tab 的 tooltip 行序等于期望当日模型序列（0 值模型不出现）；空日 11-11 显示日期 + 「无数据」 | PASS |
| 17 | filters「首屏默认近 3 天，日期框由「更多」展开」 | 四按钮顺序、threeDays 高亮、11-12 → 11-14、时间区无 select、日期框默认隐藏 | PASS |
| 18 | filters「快捷按钮回填区间与查询串，手改日期按反向匹配重算高亮」 | 四个预设的 from / to / 高亮 / 查询串；手改回预设重新高亮；非预设不高亮 | PASS |
| 19 | filters「起始晚于结束不写入筛选且不发请求，清空日期框回弹」 | 错误文案一致、起始框回弹、无新 summary 请求；清空结束日期回弹到生效值 | PASS |
| 20 | trend「`/api/timeseries` 不含 days，近 7 天画满 7 格」 | 响应无 `days`；沿轴线逐类目取 tooltip 日期，7 天全部连续命中 | PASS |
| 21 | trend「100 天区间正常生效，101 天被前端与 API 用同一文案拦截」 | 100 天首末类目分别为区间首末；101 天错误文案、无请求、API 400 同文案；不带日期 200 且有数据；恢复 7 天 | PASS |
| 22 | trend「Token 图按 DS 数据叠加价格比率行，积分图没有」 | 11-12 / 11-13 的 tooltip 出现比率行且数值等于样本口径；积分图无比率行 | PASS |
| 23 | trend「比率行带标题与 ×，柱子仍按原规则过滤排序」 | 比率行在柱子之后、含标题与 `×`；同日柱子降序、0 值模型不出现 | PASS |
| 24 | trend「筛选非 DS 模型时比率整体隐藏，页面无新增文案」 | 选 `hy4` 后 tooltip 无比率行、`body.innerText` 无该文案 | PASS |
| 25 | breakdown「分组条按模型分段，段色与趋势图一致，段宽之和等于原条宽」 | 段数 4、段色等于模型色、段宽和与 `share × 条宽` 相差 ≤1.5px、其它两个列表 0 段且保留单色条 | PASS |
| 26 | breakdown「hover 与键盘 focus 都浮出分组明细…」 | 提示 key / title / 行序 / 数值、`pointer-events: none`、行高不变、移出关闭、focus 内容一致 | PASS |

判定方式变化（覆盖项与标准保留，实现读法按框架重写）：趋势图 y 轴刻度与 series 结构无法在不读图表内部的情况下取得，改由既有 `trend-chart-option.test.ts` 与 `format` 单测锁定，e2e 只断言 tooltip、指标卡与明细的可见文本；「首帧颜色」改为「首帧即模型固定色 + 重复读取与跨筛选不变」；类目数改为「扫描 x 轴线像素定位类目中心后逐类目 hover 取日期」——7 天逐个枚举 7 个日期，100 天验证首末类目落在区间首末；整段空区间因面板不渲染图表，改由样本自检与接口断言覆盖，「无数据」分支用区间内的空日验证。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 163 passed / 1 skipped，与迁移前一致。
- `npm run acceptance`：27 passed，退出码 0，耗时约 29s；连续运行两次结果一致（另见 T011 汇总）。
- 失败诊断：故意保留的断言信息包含用例名 + 断言上下文，失败产物在 `.data/e2e-results/`（本次调试期间已验证截图与 error-context 生成）。

必要的问题与决策：用 canvas 像素定位而不是读图表实例——x 轴线 `#e6e8eb` 会被柱段遮断，取该颜色最左 / 最右像素得到绘图区边界，再按类目数均分定位；这是可见渲染结果，且比坐标估算稳定（估算版本曾把 3 个类目压到中间导致日期错位）。canvas 绘制无事件可等，`pollCanvas` 以 100ms 间隔重试至出图，仅用于绘制就绪，不替代网络等待。

提交：f6c8180

# T005 聚焦强度常量与纯函数单测

状态：done

目标与完成条件：按 Spec R1、R2 与 Plan AD-6 建立单一强度常量、按业务键判定聚焦模型，并让 `buildTrendChartOption` 生成带聚焦状态的 option；纯函数单测锁定 0.4 与四处共用，覆盖 tooltip 行、日期行与「无数据」分支、0 值过滤与降序。完成条件：满足 AC5 中由单测承担的数值正确性要求。

修改范围：`src/shared/constants.ts`、`src/web/trend-chart-option.ts`、`tests/trend-chart-option.test.ts`。

实施结果：`FOCUS_DIM_OPACITY = 0.4` 放入 `src/shared/constants.ts`；`src/web/display.ts` 新增 `focusOpacity(focusedModel, modelKey)`，按业务键返回 1.0 或常量，供趋势图 tooltip 行、分组条色段、分组浮层行三处共用（趋势图系列的减淡走 ECharts 的 blur 状态）。`buildTrendChartOption` 增加第 4 个参数 `focusedModel`（默认 `null`）：柱系列补 `blur: { itemStyle: { opacity: FOCUS_DIM_OPACITY } }`，`emphasis.focus: 'series'` 保持不变；tooltip formatter 把日期行包成 `.trend-tip-date`、模型行包成 `.trend-tip-row` 并写内联 `opacity`、比率行包成 `.trend-tip-row.is-ratio` 且不参与减淡，「无数据」包成 `.trend-tip-empty`；`tooltip.className` 设为 `trend-tooltip`，为浮层给出稳定标识。单测新增 9 条（`tests/display.test.ts` 2 条、`tests/trend-chart-option.test.ts` 7 条）：常量等于 0.4、每个柱系列的 blur 强度等于常量且 `focus` 仍为 `series`、模型行 1.0 / 0.4 的分行结果、无聚焦时全为 1.0、日期行与「无数据」不带减淡样式、比率行不减淡且 0 值过滤与降序不变、展示名相同但业务键不同时按业务键判定、浮层类名。

必要的问题与决策：减淡用 `blur.itemStyle.opacity` 而不是自绘或 `emphasis.blurScope` 调参——ECharts 的 `createBlurDefaultState` 只在未显式给 `opacity` 时使用默认的 0.1，显式给值即原样采用，因此 0.4 精确可控且不改 `focus` 语义。tooltip 的 `className` 是公开的 `tooltip.className` 配置，只给浮层一个稳定标识，不暴露图表内部状态；原「修改范围」未列 `src/web/display.ts` 与 `tests/display.test.ts`，`focusOpacity` 需要放在展示层的纯函数模块才不重复实现三遍，属实现细节。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 172 passed / 1 skipped（新增 9 条；原有「折线值为 null 时 tooltip 不追加比率行」同步改为新标记，断言口径不变）。
- `npm run acceptance`：27 passed，退出码 0，tooltip 结构变化未影响既有可见断言。

提交：4aa9bf0

# T006 趋势图聚焦

状态：done

目标与完成条件：按 Spec R3、R5 与 Plan AD-6 实现非聚焦系列减淡、tooltip 模型行聚焦、hover 柱段事件与状态清除；保留 `focus: 'series'` 语义，图例、坐标轴、空白类目不触发聚焦；切 tab、改筛选、刷新与重载后清除状态。完成条件：满足 AC1、AC2、AC6 的图表部分。

必要依赖：T005。

修改范围：`src/web/components/TrendChart.tsx`、`src/web/components/EChart.tsx`、`src/web/trend-chart-option.ts`。

实施结果：`EChart` 新增 `onSeriesHover` 与 `focusedSeriesId` 两个属性，在 `echarts.init` 后注册 `mouseover` / `mouseout` / `globalout`，只接受 `componentType === 'series'` 且 `seriesType === 'bar'` 的事件并以 `seriesId`（模型业务键）回调；图例 `componentType` 为 `legend`、坐标轴为 `grid`、空白类目没有元素事件，因此都不触发。`TrendChart` 用 `useState` 持有聚焦模型驱动系列减淡，同时用 `useRef` 保存同一值供 tooltip formatter 在指针事件内同步读取；`data` / `metric` / `ratios` 变化时清空（覆盖改筛选、刷新、重载；切 tab 直接卸载组件）。系列减淡在 `EChart` 以定向 merge 完成：`setOption({ series: [{ id, itemStyle: { opacity } }] })`，只改柱系列的 `itemStyle.opacity`，不重建 option、不动 series 结构，指针所在的 hover 与浮层不被打断。tooltip 聚焦变化后依次 `hideTip` + `showTip` 触发重绘（见下条）。柱系列改为 `emphasis: { disabled: true }`，不再依赖原生 emphasis / blur。

必要的问题与决策：**偏离 Plan AD-6 的减淡机制，需开发者知悉**。实测 ECharts 6 在 build + 无头 Chromium 下，`emphasis.focus: 'series'` 配合 `blur: { itemStyle: { opacity: 0.4 } }` 没有产生可见减淡：hover 另一系列后，被减淡系列的 canvas 像素前后完全一致（`[34,67,230,255]` 未变），只有 axisPointer 阴影改变像素。因此改为显式 opacity，作用范围仍是「该模型在所有日期的块保持 1.0，其它模型在所有日期的块 0.4」，与 R3 的语义与强度一致；`emphasis: { disabled: true }` 同时保证不会出现「聚焦项额外描边/加粗」（R2 要求高亮只靠其余减淡）。Plan AD-6 已按实际实现同步。另：ECharts 认为同一类目数据未变时不重建 tooltip 内容，故聚焦变化后派发 `hideTip` + `showTip`；两次派发在同一帧内完成，界面上没有闪烁。收尾阶段开发者确认该偏差属技术细节与文档问题，按长期维护的分层处理：Spec 只保留可见语义（整系列作用范围、0.4 强度、恢复、按业务键判定），实现手段留在 Plan 与技术架构文档；Spec 的机制性措辞已同步订正，见 Spec「收尾阶段的机制订正」。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 172 passed / 1 skipped（T005 那条断言原生 blur 的单测改为断言「柱系列不带原生 emphasis / blur」，强度改由 e2e 像素断言覆盖）。
- `npm run acceptance`：27 passed，退出码 0。
- 像素实测（临时探针，验证后已删除）：hover 另一系列后，被减淡系列的 canvas 像素 alpha 由 255 变为 102（0.4 × 255），移出后恢复 255；tooltip 行 opacity 为 1 / 0.4，比率行恒为 1。

提交：4470ea9

# T007 分组条与浮层聚焦

状态：done

目标与完成条件：按 Spec R4、R5 与 Plan AD-7 实现段级 hover 聚焦、极窄段最小命中区、浮层模型行聚焦与状态清除；段集合、段序、段色、段宽之和与条长不变，同一指针位置只判定一个模型，整行 hover / 键盘 focus 的既有规则不变。完成条件：满足 AC3、AC4、AC6 的列表部分。

必要依赖：T005。

修改范围：`src/web/components/BreakdownList.tsx`、`src/web/components/BreakdownTooltip.tsx`、`src/web/styles.css`。

实施结果：新增纯函数 `hitZoneWidths(widths, minWidth)`（`src/web/display.ts`）：视觉段宽不变，窄于最小命中宽度的段扩到阈值，缺口只从「本身宽于阈值」的段按各自可让出的宽度等比例扣除，总和保持不变，因此命中区首尾相接、同一指针位置只会落在一个段上；全部段都窄于阈值时按平均值均分。`BreakdownList` 用 `ResizeObserver` 量出首行数值条的像素宽度，把 8px 阈值换算成百分比；色段加 `data-model` 并按 `focusOpacity` 写内联 opacity；色段之上叠一层透明命中区（`.breakdown-hit-layer` / `.breakdown-hit-zone`，层 `pointer-events: none`、区域 `auto`），用事件委托在 `mouseover` / `mouseout` 时设置与清除聚焦；`rows` / `metric` 变化时清空聚焦，行 `mouseleave` 同时清整行状态与聚焦，整行 hover / focus 浮出提示与点击筛选取值均不变。`BreakdownTooltip` 新增 `focusedModel`，按业务键给每个模型行写 opacity，内容、降序、0 值过滤、`pointer-events: none` 与定位不变。`styles.css` 把 `.breakdown-bar` 改为 `position: relative` 并新增命中区样式。

必要的问题与决策：最小命中宽度取 8px（实现细节，Plan 允许在 Tasks 阶段按实测确定）：样本极窄段视觉宽度为 1.44px，扩到 8px 后足够稳定命中，同时相邻宽段只让出约 3px，视觉无感。命中区做成独立覆盖层而不是给色段加伪元素，是为了让「扩展量」能按相邻段可让出的宽度精确扣除，保证不越过边界、不覆盖条上未着色的空白部分。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 176 passed / 1 skipped（新增 `hitZoneWidths` 4 条）。
- `npm run acceptance`：27 passed，退出码 0。
- 探针实测（验证后已删除）：首行视觉段宽 145.31 / 58.13 / 24.22 / 1.44px，命中区宽 140.89 / 56.50 / 23.69 / 8.00px、左界 0 / 140.89 / 197.39 / 221.08（首尾相接、无重叠），总宽 229.08 与视觉段宽之和 229.10 一致；hover 极窄段后四个色段 opacity 为 0.4 / 0.4 / 0.4 / 1，浮层四个模型行为 0.4 / 0.4 / 0.4 / 1，移出后全部回到 1。

提交：de5c73c

# T008 hover 聚焦的 e2e 断言

状态：done

目标与完成条件：按 Spec AC13 与 Plan AD-4 把 AC1–AC7 写成可见行为用例，覆盖减淡与恢复、极窄段命中、tooltip 行聚焦、状态独立与解除以及 AC7 的既有回归项；断言页面可见的渲染状态，不调用图表内部函数。完成条件：逐条 PASS，失败时输出用例名与失败断言。

必要依赖：T004、T006、T007。

修改范围：`tests/e2e/`。

实施结果：新增 `tests/e2e/focus.spec.ts` 共 11 条用例。AC1：Token / 积分两张图各一条，hover 某系列的柱段后，被减淡系列的 canvas 像素 alpha 为 102（0.4 × 255，容差 ±3），聚焦系列在其它日期的柱段仍为 255，移出后全部恢复 255。AC2：tooltip 行随聚焦变成 1.0 / 0.4，日期行恒为 1.0；全 0 日只有日期与「无数据」、没有模型行；hover 图例不产生减淡；hover 网格内柱段上方的空白位置时所有行为 1.0。AC3：hover 极窄段后该段 1.0、同条其它段 0.4，段集合、段色、视觉段宽与条长不变；命中区每段一个、首尾相接不重叠、每个不小于 8px、总宽等于色段总宽。AC4：浮层对应模型行 1.0、其它行 0.4，行内非段区域与键盘 focus 时全部 1.0，内容与降序、`pointer-events: none` 不变。AC5：分组段、浮层行、趋势图系列（alpha / 255）、趋势图 tooltip 行四处都是同一个 0.4，比率行恒为 1.0。AC6：图表聚焦不改变列表、列表聚焦不改变图表，切 tab 与改筛选、刷新后都不残留聚焦。AC7：8 行截断与项数、按对话 / 按模型仍为单色条且没有命中区、指标卡与缓存命中率、明细折叠与排序、0 值模型不进 tooltip。页面对象补了 `canvasPointOf(color, 'top' | 'bottom')`、`hoverLegend()`、`hoverChartBlank()`（网格内柱段上方的空白位置）与 `trendTooltipState()` 的模型行 / 比率行拆分。

必要的问题与决策：canvas 断言用「同一坐标在聚焦前后的像素」而不是读图表配置：柱段绘制为 0.4 不透明度时 alpha 通道为 102，可以直接量出强度，也能验证恢复。空白区用「网格内、柱段上方」而不是画布顶端——画布顶端在 grid 之外，ECharts 不触发坐标轴浮层且浮层是异步隐藏的，读到的是上一次内容。

验证：
- `npm run typecheck`：退出码 0。
- `npm test`：18 个文件 176 passed / 1 skipped。
- `npm run acceptance`：38 passed（27 条既有覆盖 + 11 条聚焦用例），退出码 0，耗时约 39s。
- 失败可诊断：调试期间的失败输出均带用例名与断言上下文，截图与 error-context 落在 `.data/e2e-results/`。

提交：e06c636

# T009 入口切换与旧脚本退役

状态：done

目标与完成条件：按 Spec R11、AC9、AC10 在新入口通过后移除 `scripts/panel-acceptance.mjs`，`npm run acceptance` 指向新框架入口；仓库中不再存在自研 CDP 客户端，也不存在以固定时长 `wait()` 与字符串拼接 `Runtime.evaluate` 为主体的用例。对照记录固化后才能删除旧脚本；T002 只建配置骨架，入口切换在本任务完成。

必要依赖：T004、T008。

修改范围：`package.json`、`scripts/panel-acceptance.mjs`。

实施结果：T004 与 T008 的对照记录已固化后，删除 `scripts/panel-acceptance.mjs`（仓库中唯一含自研 CDP 客户端、固定 `wait()` 轮询与字符串拼接 `Runtime.evaluate` 的文件）；`npm run acceptance` 在 T002 已改为 `node scripts/e2e-run.mjs`，本任务无需再改。`scripts/` 只留 `e2e-fixture.mjs` 与 `e2e-run.mjs`。

验证：
- 删除后 `npm run typecheck`：退出码 0。
- 删除后 `npm run acceptance`：38 passed，退出码 0（样本 → 构建 → 4630 服务 → 用例 → 清理全链路）。
- `grep -rn "Runtime.evaluate|remote-debugging-port|Emulation.setFocusEmulation"`（`*.ts` / `*.mjs` / `*.json`，排除 `node_modules` 与 `.data`）：无命中；`panel-acceptance` 只出现在历史交付文档的路径字面里（按 Spec 保留为当时事实），`devops.md` 的引用已随本任务记录回填一并重写。

提交：b813386（实现）、f411839（记录回填）

# T010 长期文档同步

状态：done

目标与完成条件：按 Spec R11、AC8 与 Plan「测试策略」的文档同步检查，重写 `devops.md`「交互验收」章节（不再要求手工启动调试 Chrome，补 `npx playwright install chromium` 步骤；`DATABASE_PATH` 用法已由前置改动记录，本任务只核对）、在 `technical-architecture.md` 补开发期测试依赖、测试分层说明与面板层 hover 聚焦描述。完成条件：长期文档与代码不存在已知矛盾，历史交付文档与归档文档不改写。

必要依赖：T009。

修改范围：`docs/devops.md`、`docs/technical-architecture.md`。

必要的问题与决策：两份长期文档的重写实际随 `f411839`（T009 记录回填）一并提交，`ef331f8` 只补写本任务的实施记录；两个 commit 因此各跨两类变更，与「一个 commit 对应一个原子变更」有偏差。提交已固化、不改写历史，收尾在 Tasks 中如实标注归属，后续交付按任务分开提交。

实施结果：`devops.md` 的「交互验收」章节整体重写：Playwright 一条命令、Node 24 需在 PATH 首位、默认 CDN 不可达时的镜像安装方式、固定执行顺序（样本 → 构建 → 用例 → 清理）与不可颠倒的原因、临时样本与 4630 端口、只读与时间冻结、`.data/e2e/` 清理与 `.data/e2e-results/` 失败产物、八个用例文件的职责、不替代 Vitest、单文件与 `--grep` 调试方式；删除了旧 CDP 脚本的操作说明、`BASE_URL` / `CDP_PORT` / `SCREENSHOT_DIR` 变量与「全量区间跨度」限制段落。`technical-architecture.md` 的关键依赖表补 `@playwright/test`（开发期）一行，新增「测试分层」章节（Vitest 纯函数与服务层 / Playwright 可见行为、文件后缀隔离、固定样本与 4630 端口），并在模块划分补一段 hover 聚焦语义（统一强度、按系列整体减淡、极窄段命中区、状态只在内存、图例与键盘不触发、不依赖 `emphasis.focus`）。`DATABASE_PATH` 的用法与取值已由前置改动写入 `devops.md` 配置表，本任务核对无差异。

验证：
- 文档中的命令与实现一致：`package.json` 的 `acceptance` 为 `node scripts/e2e-run.mjs`，`playwright.config.ts` 端口 4630、`DATABASE_PATH=.data/e2e/database.db`、`WORKBUDDY_HOME=.data/e2e/home`，`scripts/e2e-run.mjs` 顺序为样本 → 构建 → playwright → 清理，`tests/e2e/` 的八个文件与章节列举一致。
- `npm run acceptance`：38 passed，退出码 0（文档描述的流程实际可跑）。
- `grep -rn "panel-acceptance|CDP" docs/devops.md`：无命中；历史交付文档与 `docs/delivery/v1.0.0/` 未改写（仍保留当时的路径字面）。

提交：f411839（实现）、ef331f8（实施记录回填）

# T011 收尾与全量检查

状态：done

目标与完成条件：按 AGENTS.md 第 5 节逐项确认 Spec AC1–AC14 已满足；全量执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`，连续两次验收结果一致；核对 Tasks 状态与实施记录、一次性回填 T001–T010 的提交字段；检查 `product-brief.md`、`technical-architecture.md`、`data-model.md` 及相关长期文档与实现一致，`docs/backlog/` 中与本次交付相关的条目已更新或移除。本任务为收尾任务。

必要依赖：T001–T010。

修改范围：交付文档、长期文档。

实施结果：收尾提交 `54581bb` 已逐项核对 AC1–AC14、回填 T001–T010 提交字段，并把 `docs/backlog/panel-acceptance-segment-width.md` 改写为「多分段行的段宽累计舍入」剩余风险（旧脚本已退役，固定样本首行只有 4 段，7 段以上未复测）。本次复核订正了记录与实现不符之处：T009 验证里 `devops.md` 重写时机的表述、T010 的提交字段归属（见该任务「必要的问题与决策」）、`hover-model-focus-plan.md` 的 AD-4 / 影响范围 / 测试策略中仍写原生 blur 与「canvas 不进自动断言」的过期描述，以及 `src/web/trend-chart-option.ts` 的同类过期注释。机制偏差经开发者确认按技术细节与文档问题处理：`hover-model-focus-spec.md` 的 R2 / R3 / AC1 / AC2 /「已确认决策」只保留可见语义，实现手段留在 Plan 与 `technical-architecture.md`，并补入价格比率折线的聚焦规则（R3、AC2、已确认决策，明细见 T012）。全量检查在 T012 完成后重新执行。

验证：
- `npm run typecheck`：退出码 0（Node 24.19.0，`tsc --noEmit`；折线 `triggerEvent` 的字面量推断问题已修正并复核）。
- `npm test`：18 个文件 179 passed / 1 skipped（180），较收尾提交新增 3 条（比率行三种聚焦状态、折线事件配置）。
- `npm run build`：服务端 tsc + 前端 Vite 622 模块，产物 784.14 kB；Vite 输出 500 kB chunk 提示，非错误。
- `npm run acceptance`：两次均为 39 passed、退出码 0，用例清单一致（40.2s / 38.8s），运行后 `.data/e2e/` 已清理。两次运行前各自移走上一轮 `.data/e2e-results/`：Playwright 启动时会清空 `outputDir`，本轮 screencast 临时文件约 1500 个，直接连跑会触发当前 Node 运行环境的批量删除保护（阈值 50）并以退出码 1 结束；属环境守卫行为，与项目代码无关，清掉产物后重跑通过。
- 文档核对：`product-brief.md` / `data-model.md` 无事实变化（本交付不改口径与数据结构）；`devops.md` / `technical-architecture.md` 由 T010 同步，命令与配置逐项一致；`docs/backlog/subagent-credit-reconciliation.md` 与本交付无关。
- 提交核对：T001–T010 的任务提交均带 `Tasks-Doc` / `Tasks` 且编号存在，标题符合 `[<type>]<topic>`；`f411839` 与 `ef331f8` 的跨任务归属偏差已记入 T010。

必要的问题与决策：趋势图减淡机制与 Spec 字面描述的偏差已由开发者确认属技术细节与文档问题，按「需求写语义、方案写手段」订正 Spec，验收口径（整系列作用范围、0.4 强度、恢复、按业务键判定）不变；T006 已补记确认依据。收尾核对阶段按开发者要求追加折线 tooltip 聚焦，作为 T012 并入本交付，不新建交付文档。T012 的实现提交为 `d68d3c4`，文档同步随本次收尾提交纳入。

# T012 价格比率折线参与统一聚焦

状态：done

目标与完成条件：修正「hover 柱段时折线的 tooltip 行仍保持高亮」：hover 柱段时比率行随其它非聚焦行减淡；hover 折线时只有比率行常态、所有模型行减淡；无聚焦时全部常态。判定沿用同一常量与系列业务键，画布上的折线与柱系列按同一强度同步减淡，既有 38 条用例不回归。

必要依赖：T011（收尾核对阶段追加，全量检查在完成后重跑）。

修改范围：`src/web/trend-chart-option.ts`、`src/web/components/EChart.tsx`、`tests/trend-chart-option.test.ts`、`tests/e2e/panel-page.ts`、`tests/e2e/focus.spec.ts`、`hover-model-focus-spec.md` / `-plan.md` / `-tasks.md`、`docs/technical-architecture.md`。

实施结果：`buildTrendChartOption` 的比率行不再固定常态，改用 `focusOpacity(聚焦键, PRICE_RATIO_SERIES_ID)` 写内联 opacity，复用 R1 / R2 的业务键判定与唯一强度常量；折线系列设 `triggerEvent: 'line'`（ECharts 6 推荐写法，取代已废弃的 `triggerLineEvent`）让线段本身可触发 `mouseover`，并关掉原生 emphasis、给 `lineStyle` / `itemStyle` 显式初始 opacity。`EChart` 的 hover 事件从「只认 bar」扩到 bar / line；折线线段事件的 `eventData` 不带 `seriesId`，改由 `seriesIndex` 回查当前 option 的 series id（这是本次调试定位到的根因，否则聚焦键会落成 `null`）。定向 merge 同时 patch 折线的 `lineStyle.opacity` / `itemStyle.opacity`，使画布状态与 tooltip 行一致。页面对象新增 `ratioLinePoint()`（取折线纯色像素中 3×3 邻域最密处，优先落在数据点圆心）与 `hoverBarOnRatioDay()`（同一类目内找柱段，保证那天有比率行）；`focus.spec.ts` 新增 1 条折线聚焦用例，AC5 的「比率行不参与减淡」断言改为「聚焦柱段时比率行随非聚焦行减淡」。Spec 的 R3 / AC2 /「已确认决策」补入折线聚焦规则并附「收尾阶段的机制订正」段，Plan AD-4 / AD-6 / 测试策略与 `technical-architecture.md` 同步。

验证：
- `npm run typecheck`：退出码 0（含 `triggerEvent: 'line' as const` 的字面量复核）。
- `npm test`：18 文件 179 passed / 1 skipped；新增 3 条锁定 hover 柱段 / hover 折线 / 无聚焦时比率行的强度与折线事件配置。
- `npm run build`：退出码 0。
- `npm run acceptance tests/e2e/focus.spec.ts`：12 passed；全量连续两次 39 passed、退出码 0，用例清单一致（另见 T011）。
- 像素与 DOM 断言：hover 折线后比率行 1.0、模型行全 0.4、柱系列 canvas alpha 102；hover 同日柱段后比率行 0.4、聚焦模型行 1.0；移到空白区全部恢复 1.0。

必要的问题与决策：折线是否连画布一起减淡由本次自行判定为「是」——tooltip 行减淡而画布折线保持常态会造成同一聚焦状态下视觉不一致，故按 R2 的同一强度扩展；折线聚焦状态仍只在内存，不进 URL、不持久化，切 tab / 改筛选 / 刷新沿用 T006 的清除逻辑。经开发者确认后提交，实现提交见下，文档同步随收尾提交纳入；收尾提交自身的 hash 不记录。

提交：d68d3c4
