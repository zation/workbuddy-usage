# 用量统计 Tasks

本文件按 [usage-stats-plan.md](./usage-stats-plan.md) 的技术方案拆分；业务规则与验收标准见 [usage-stats-spec.md](./usage-stats-spec.md)，派生库约束见 [data-model.md](../data-model.md)。任务编号稳定，依赖关系决定实际执行顺序。

## 执行顺序与依赖

T001 → T002 → T003 / T004（可并行）→ T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013。

Plan「一次刷新的执行顺序」中的 7 条约束是硬依赖，尤其：请求行落定后才能挂积分（T007 先于 T008）、`source_files` 扫描状态与文件事务同提交、先递增 `schema_version` 再改 DDL。每个任务通过验证后按 AGENTS.md 第 6 节提交一次；T012、T013 为收尾任务，不填提交字段。

# T001 工程脚手架与构建配置

状态：done

目标：建立可运行、可类型检查的全 TypeScript 单仓骨架，依赖与脚本对齐 Plan「目录与分层」。

完成条件：`npm install` 成功；`tsc --noEmit` 与 `npm run build` 通过；`npm run dev` 能同时启动 Vite 与 API 并通过 proxy 转发 `/api`；`.gitignore` 覆盖 `.data/`、`dist/`、`node_modules/`、`.env.local`。

修改范围：仓库根配置（`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`.gitignore`）。

实施结果：按 Plan 依赖建立 Vite + React 面板与 Hono API 的单仓骨架；服务端用 Node 24 原生类型剥离直接运行 `server/index.ts`，不引入额外运行器。新增 `tsconfig.build.json`（服务端编译到 `dist/server`），Web 由 Vite 构建到 `dist/web`。为满足 dev 联调完成条件，同时创建了最小 `server/index.ts`、`src/web/index.html`、`main.tsx`、`App.tsx` 与样式文件，后续任务在其上扩展。`.gitignore` 原有条目已覆盖 `.data/`、`dist/`、`node_modules/`、`.env.local`，未改动。

验证：`npm install` 成功；`npm run typecheck` 通过；`npm run build` 通过（服务端 tsc + Vite，产物 `dist/server/index.js` 与 `dist/web/`）；`npm run dev` 同时启动 API（`127.0.0.1:4620`）与 Vite（`127.0.0.1:5173`），`curl http://127.0.0.1:5173/api/health` 经 proxy 返回 `{"ok":true}`，首页返回 200。

提交：

# T002 共享类型契约

状态：done

目标：定义 ETL 与面板共用的类型，保证 AD-1 的类型贯通。

完成条件：请求级记录、维度业务键、API 响应与刷新结果都有类型；`src/etl/`、`server/`、`src/web/` 可引用且 `tsc --noEmit` 通过；API 类型中不含派生库内部 `id`（C14）。

依赖：T001。

修改范围：`src/shared/`。

实施结果：`src/shared/types.ts` 定义来源文件、外部会话元信息、请求级记录、解析告警、刷新结果与五个端点的请求/响应类型，全部使用业务键与展示名，不含内部 `id`；`src/shared/dates.ts` 提供本地时区日期派生、日期加减、合法性校验与含首尾区间枚举，供解析层和服务层共用。

验证：`npm run typecheck` 通过；`npm test` 5 个用例通过（日期派生、跨月加减、区间枚举、日期校验、契约字段可构造且 `RequestRow` 无 `id` 字段）。为验证跨目录引用，新增 `tests/shared.test.ts`，超出本任务修改范围但属共享契约的必要验证。

提交：

# T003 派生索引 schema 与版本控制

状态：done

目标：按 data-model 建立六张表、索引与 `meta` 单行，并实现 `schema_version` 不匹配即删库重建。

完成条件：启动后生成 `.data/index.db`；表、列、UNIQUE 与索引和 data-model 一致；人为改低 `schema_version` 后启动会重建而非报错；重建后内部 `id` 允许重新分配。

依赖：T001、T002。

修改范围：`src/etl/`（schema 与连接管理）。

实施结果：`src/etl/config.ts` 解析 `WORKBUDDY_HOME` 与固定索引路径，并提供外部库、projects 根目录定位；`src/etl/index-db.ts` 建立 `groups` / `sessions` / `models` / `source_files` / `requests` / `meta` 六张表、五个查询索引与业务键 UNIQUE，`meta` 以 `CHECK (id = 1)` 保证单行。打开时先探测 `schema_version`，不匹配或文件不可读则关闭连接、删除 `index.db` 及其 `-wal` / `-shm` / `-journal` 后重建，新库直接写入 `last_full_scan_at`。服务启动时打开索引并打印是否重建。

验证：`npm run typecheck` 通过；`npm test` 9 个用例通过，其中索引测试覆盖六张表、`requests` 列顺序、五个索引、`meta` 单行与业务键唯一约束、默认 journal 模式、版本不匹配删库重建且内部 `id` 从 1 重新分配、版本一致时保留数据。手工启动服务生成 `.data/index.db`；用 `node:sqlite` 将 `schema_version` 改为 0 后重启，日志显示「已重建」，`meta.schema_version` 恢复为 1，服务正常监听。

提交：

# T004 外部数据只读访问与扫描

状态：pending

目标：只读打开 `workbuddy.db`，扫描 jsonl 并产出待解析集合，字段映射集中一处。

完成条件：以 `readOnly: true` 打开且写入被拒；能读取 `sessions` / `session_usage`；递归找到 `*.jsonl` 并正确判定 `main` / `subagent`，排除 `.ndjson` 等无关文件；`size_bytes` / `mtime_ms` 取解析前的 stat（C9）。

依赖：T001、T002。

修改范围：`src/etl/`（外部数据源访问与扫描）。

# T005 逐行解析与按请求归并

状态：pending

目标：把 jsonl 事件流归并为请求级记录，落实 C2–C5 口径。

完成条件：不完整行与时间戳非法的行跳过并计入解析告警；同一 `conversationRequestId` 取 `total_tokens` 最大那条的四个同源字段（C2，含非单调反例）；C3 / C4 校验告警可观测；`started_at` / `ended_at` 取全部步骤边界；`date_key` 按本地时区派生；未知字段与未知事件类型不中断解析。

依赖：T004。

修改范围：`src/etl/`（解析与归并）。

# T006 维表 upsert 与业务键换 id

状态：pending

目标：维护 `groups` / `sessions` / `models` / `source_files`，把业务键换成内部外键，落实 C7、C11–C14。

完成条件：四类业务键通过 `INSERT ... ON CONFLICT DO NOTHING` + `SELECT id` 得到唯一行；模型展示名按 C12 规范化且与文件遍历顺序无关；`sessions.display_name` 按 R6 优先级；维表行缺失时按 C13 兜底；外部会话被清理后已有维表行保留（C11）；分组归属按 C7 取解析时刻快照。

依赖：T003、T005。

修改范围：`src/etl/`（维表与关联）。

# T007 文件原子替换与刷新编排

状态：pending

目标：实现 C1 / C8 / C9 / C10 的写入语义与一次刷新的互斥编排。

完成条件：变化文件在单一事务内先按 `source_file_id` 删除再插入，请求消失后不残留，同文件其它请求数值不变；`source_files` 状态与事务同提交，解析失败不推进；文件不存在时按 C8 清理对应请求；刷新互斥锁覆盖全流程，并发触发只执行一次；数据无变化时跳过重解析（AC4）；`meta.last_refresh_at` 与刷新返回值正确。

依赖：T003、T006。

修改范围：`src/etl/`（写入与刷新编排）。

# T008 积分独立挂接

状态：pending

目标：把积分挂接做成与文件增量解耦的独立通道（AD-7、C6）。

完成条件：每次刷新无条件重读 `session_usage` 并合成映射；只更新映射中存在的请求（含值修正），映射外不触碰、不主动清零；积分值为 0 时 `has_credit = 1`；jsonl 无变化而积分晚到时能补挂（AC9）。

依赖：T007。

修改范围：`src/etl/`（积分挂接）。

# T009 服务层 API 与聚合

状态：pending

目标：实现 Plan「服务层」与架构文档接口段的五个端点。

完成条件：入参与返回值只用业务键字符串，服务层转换为内部 `id` 过滤（C14）；`from` / `to` 映射为含首尾的 `date_key` 区间（R12）；聚合全部在 SQL，LEFT JOIN 维表取业务键与展示名，维度筛选值取 JOIN 结果的 `DISTINCT`；`timeseries` 固定按天、按模型拆分；`summary` 提供覆盖率所需的 `has_credit` 计数（AC8）；分组求和等于总览（AC3）；生产模式提供静态资源且仅监听 `127.0.0.1`。

依赖：T007、T008。

修改范围：`server/`。

# T010 面板骨架与四筛选器

状态：pending

目标：实现 Spec 行为 1、4、6 的模块结构与筛选联动。

完成条件：Token 与积分两个模块不混排指标，共用时间 / 分组 / 对话 / 模型四个筛选器且无其它开关；默认时间今天；时间粒度只有天；点击分组或模型加入当前模块筛选，点击对话进入明细；面板只渲染 API 结果，不自行求和或换算（AD-4）。

依赖：T009。

修改范围：`src/web/`（布局、筛选状态、路由/视图切换）。

# T011 面板图表、指标卡与明细

状态：pending

目标：实现 Spec 行为 2、3、5、7、8 的呈现与刷新入口。

完成条件：两模块各自的指标卡、按天趋势、四维度分布与占比、请求级明细表齐备；堆叠只按模型着色；积分模块显示覆盖率（AC8）并标注"子代理无本地积分记录"；明细列与排序符合行为 7；刷新入口展示扫描文件数、新增或更新请求数、补挂积分条数与耗时；首屏满足 AC11。

依赖：T010。

修改范围：`src/web/`（图表、表格、刷新交互）。

# T012 集成测试与全量验收

状态：pending

目标：用固定 fixture 跑通 AC1–AC11，并执行全量检查。

完成条件：按 Plan「测试策略」执行独立 `tsc --noEmit`、Vitest 单测、`npm run build`；样本 `WORKBUDDY_HOME` 的全量刷新结果逐条核对 AC1–AC11（含多步骤、子代理、无积分记录、文件被移除、会话行缺失等场景）；只读连接写入被拒得到验证；记录每条命令、结果与未执行检查的原因。全量检查结果集中记录在本任务。

依赖：T001–T011。

修改范围：测试目录、全仓检查记录。

# T013 交付收尾检查与文档同步

状态：pending

目标：按 AGENTS.md 第 5 节逐项收尾，保证需求—计划—任务—提交可追踪。

完成条件：Spec 的 AC1–AC11 均满足或已记录剩余风险；各任务状态与实施记录准确完整，已实施任务的提交 hash 统一回填；`product-brief.md`、`technical-architecture.md`、`data-model.md`、`integration.md`、`devops.md` 按实现同步且与代码无已知矛盾；`docs/backlog/` 相关条目已处理；收尾检查结果记录在本任务。

依赖：T012。

修改范围：`docs/`、本文件。
