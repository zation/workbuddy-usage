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

提交：

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

提交：

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

提交：

# T004 迁移既有 26 项覆盖为可见行为用例

状态：pending

目标与完成条件：按 Plan AD-4、AD-9 与 Spec R8、AC10 逐项重写用例：断言 DOM 文本、计算样式、几何、tooltip 浮层与网络请求等用户可见结果，不读 ECharts 实例、不调用 option / formatter，格式化与刻度逻辑留在既有 Vitest 单测。逐项对照记录写进本任务实施记录，全部 PASS、退出码 0，无删除覆盖、跳过断言或放宽标准。

必要依赖：T001、T002、T003。

修改范围：`tests/e2e/`。

# T005 聚焦强度常量与纯函数单测

状态：pending

目标与完成条件：按 Spec R1、R2 与 Plan AD-6 建立单一强度常量、按业务键判定聚焦模型，并让 `buildTrendChartOption` 生成带聚焦状态的 option；纯函数单测锁定 0.4 与四处共用，覆盖 tooltip 行、日期行与「无数据」分支、0 值过滤与降序。完成条件：满足 AC5 中由单测承担的数值正确性要求。

修改范围：`src/shared/constants.ts`、`src/web/trend-chart-option.ts`、`tests/trend-chart-option.test.ts`。

# T006 趋势图聚焦

状态：pending

目标与完成条件：按 Spec R3、R5 与 Plan AD-6 实现非聚焦系列减淡、tooltip 模型行聚焦、hover 柱段事件与状态清除；保留 `focus: 'series'` 语义，图例、坐标轴、空白类目不触发聚焦；切 tab、改筛选、刷新与重载后清除状态。完成条件：满足 AC1、AC2、AC6 的图表部分。

必要依赖：T005。

修改范围：`src/web/components/TrendChart.tsx`、`src/web/components/EChart.tsx`、`src/web/trend-chart-option.ts`。

# T007 分组条与浮层聚焦

状态：pending

目标与完成条件：按 Spec R4、R5 与 Plan AD-7 实现段级 hover 聚焦、极窄段最小命中区、浮层模型行聚焦与状态清除；段集合、段序、段色、段宽之和与条长不变，同一指针位置只判定一个模型，整行 hover / 键盘 focus 的既有规则不变。完成条件：满足 AC3、AC4、AC6 的列表部分。

必要依赖：T005。

修改范围：`src/web/components/BreakdownList.tsx`、`src/web/components/BreakdownTooltip.tsx`、`src/web/styles.css`。

# T008 hover 聚焦的 e2e 断言

状态：pending

目标与完成条件：按 Spec AC13 与 Plan AD-4 把 AC1–AC7 写成可见行为用例，覆盖减淡与恢复、极窄段命中、tooltip 行聚焦、状态独立与解除以及 AC7 的既有回归项；断言页面可见的渲染状态，不调用图表内部函数。完成条件：逐条 PASS，失败时输出用例名与失败断言。

必要依赖：T004、T006、T007。

修改范围：`tests/e2e/`。

# T009 入口切换与旧脚本退役

状态：pending

目标与完成条件：按 Spec R11、AC9、AC10 在新入口通过后移除 `scripts/panel-acceptance.mjs`，`npm run acceptance` 指向新框架入口；仓库中不再存在自研 CDP 客户端，也不存在以固定时长 `wait()` 与字符串拼接 `Runtime.evaluate` 为主体的用例。对照记录固化后才能删除旧脚本；T002 只建配置骨架，入口切换在本任务完成。

必要依赖：T004、T008。

修改范围：`package.json`、`scripts/panel-acceptance.mjs`。

# T010 长期文档同步

状态：pending

目标与完成条件：按 Spec R11、AC8 与 Plan「测试策略」的文档同步检查，重写 `devops.md`「交互验收」章节（不再要求手工启动调试 Chrome，补 `npx playwright install chromium` 步骤；`DATABASE_PATH` 用法已由前置改动记录，本任务只核对）、在 `technical-architecture.md` 补开发期测试依赖、测试分层说明与面板层 hover 聚焦描述。完成条件：长期文档与代码不存在已知矛盾，历史交付文档与归档文档不改写。

必要依赖：T009。

修改范围：`docs/devops.md`、`docs/technical-architecture.md`。

# T011 收尾与全量检查

状态：pending

目标与完成条件：按 AGENTS.md 第 5 节逐项确认 Spec AC1–AC14 已满足；全量执行 `npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`，连续两次验收结果一致；核对 Tasks 状态与实施记录、一次性回填 T001–T010 的提交字段；检查 `product-brief.md`、`technical-architecture.md`、`data-model.md` 及相关长期文档与实现一致，`docs/backlog/` 中与本次交付相关的条目已更新或移除。本任务为收尾任务。

必要依赖：T001–T010。

修改范围：交付文档、长期文档。
