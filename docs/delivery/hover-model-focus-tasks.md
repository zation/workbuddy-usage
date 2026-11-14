# Hover 模型聚焦与交互验收框架化 Tasks

本文件按 [hover-model-focus-plan.md](./hover-model-focus-plan.md) 的技术方案拆分；业务规则与验收标准见 [hover-model-focus-spec.md](./hover-model-focus-spec.md)。任务编号稳定，依赖关系决定实际执行顺序。

**前置提交已完成**：数据库命名重构（`database.db` / `database.ts` / `openDatabase` / `closeDatabase` / `databasePath`）、可选环境变量 `DATABASE_PATH` 与全项目术语统一，已在 `6afb3b8` 落地并通过 `npm run typecheck`、`npm test`、`npm run build`。本文件不重复这部分工作，对应 Spec 已确认决策与 Plan「命名与术语统一」一节。

## 执行顺序与依赖

按 Plan「顺序约束」执行：覆盖清单先固化、再逐项重写用例；聚焦实现先定 0.4 常量与业务键判定，再做四处渲染与状态清除，最后接 e2e 断言；旧脚本在对照完成前不得删除；长期文档在功能与验收通过后同步。运行时顺序固定为「生成样本 → 构建 → 启动服务（首次刷新读样本、按 `DATABASE_PATH` 建临时数据库）→ 执行用例 → 清理」，不可颠倒。

依赖关系：T001 与 T005 可先行；T001 + T002 + T003 → T004（其中 T002 → T003）；T005 → T006、T007；T004 + T006 + T007 → T008；T004 + T008 → T009；T009 → T010；T001–T010 → T011。

## 任务

# T001 固化 26 项验收覆盖清单

状态：pending

目标与完成条件：从 `scripts/panel-acceptance.mjs` 的 `check()` 调用逐项提取覆盖项名称、判定条件与阈值（当前 26 项覆盖；AC14 的正常 / skip 分支属同一项），形成迁移对照基线。按 Spec R8 与 AC10，对照的是覆盖项与判定标准，不是旧脚本的实现方式或数值结果；清单逐项可核对，并作为 T004 实施记录的对照来源，不新建独立验证文档。

修改范围：`scripts/panel-acceptance.mjs`（只读）。

# T002 Playwright 运行器与验收入口骨架

状态：pending

目标与完成条件：按 Plan AD-1、AD-2、AD-8 建立配置与运行器隔离，`npm run acceptance` 串起样本生成、构建、`webServer` 启停、用例执行与清理；用例目录不被 Vitest 收集、被 typecheck 覆盖；失败保留 trace 与截图。完成条件：单命令能启动服务并跑到用例（可先用一个最小用例验证启停与清理），满足 AC9 的框架化要求与 AC11 的一条命令要求。本任务只建配置骨架，验收入口的最终指向与旧脚本摘除统一归 T009。

修改范围：`package.json`、`playwright.config.ts`、`tsconfig.json`。

# T003 固定样本与期望值生成

状态：pending

目标与完成条件：按 Plan AD-5 与 Spec AC12 建立临时 `WORKBUDDY_HOME`、固定期望数据、浏览器时间冻结与样本自检；`DATABASE_PATH` 指向同一临时目录下的数据库。样本覆盖 AD-5 列出的场景，重复运行结果一致，运行结束临时目录与数据库被清理，运行配置中不含真实 `~/.workbuddy` 路径。

必要依赖：T002。

修改范围：`scripts/e2e-fixture.mjs`、`tests/e2e/`。

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
