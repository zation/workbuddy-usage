# 用量统计 Tasks

本文件按 [usage-stats-plan.md](./usage-stats-plan.md) 的技术方案拆分；业务规则与验收标准见 [usage-stats-spec.md](./usage-stats-spec.md)，派生库约束见 [data-model.md](../data-model.md)。任务编号稳定，依赖关系决定实际执行顺序。

## 执行顺序与依赖

T001 → T002 → T003 / T004（可并行）→ T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013。

Plan「一次刷新的执行顺序」中的 7 条约束是硬依赖，尤其：请求行落定后才能挂积分（T007 先于 T008）、`source_files` 扫描状态与文件事务同提交、先递增 `schema_version` 再改 DDL。每个任务通过验证后按 AGENTS.md 第 6 节提交一次；T013 为收尾任务，不填提交字段；T012 有独立实施提交，需回填对应 hash。

# T001 工程脚手架与构建配置

状态：done

目标：建立可运行、可类型检查的全 TypeScript 单仓骨架，依赖与脚本对齐 Plan「目录与分层」。

完成条件：`npm install` 成功；`tsc --noEmit` 与 `npm run build` 通过；`npm run dev` 能同时启动 Vite 与 API 并通过 proxy 转发 `/api`；`.gitignore` 覆盖 `.data/`、`dist/`、`node_modules/`、`.env.local`。

修改范围：仓库根配置（`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`.gitignore`）。

实施结果：按 Plan 依赖建立 Vite + React 面板与 Hono API 的单仓骨架；服务端用 Node 24 原生类型剥离直接运行 `server/index.ts`，不引入额外运行器。新增 `tsconfig.build.json`（服务端编译到 `dist/server`），Web 由 Vite 构建到 `dist/web`。为满足 dev 联调完成条件，同时创建了最小 `server/index.ts`、`src/web/index.html`、`main.tsx`、`App.tsx` 与样式文件，后续任务在其上扩展。`.gitignore` 原有条目已覆盖 `.data/`、`dist/`、`node_modules/`、`.env.local`，未改动。

验证：`npm install` 成功；`npm run typecheck` 通过；`npm run build` 通过（服务端 tsc + Vite，产物 `dist/server/index.js` 与 `dist/web/`）；`npm run dev` 同时启动 API（`127.0.0.1:4620`）与 Vite（`127.0.0.1:5173`），`curl http://127.0.0.1:5173/api/health` 经 proxy 返回 `{"ok":true}`，首页返回 200。

提交：e6fbdda

# T002 共享类型契约

状态：done

目标：定义 ETL 与面板共用的类型，保证 AD-1 的类型贯通。

完成条件：请求级记录、维度业务键、API 响应与刷新结果都有类型；`src/etl/`、`server/`、`src/web/` 可引用且 `tsc --noEmit` 通过；API 类型中不含派生库内部 `id`（C14）。

依赖：T001。

修改范围：`src/shared/`。

实施结果：`src/shared/types.ts` 定义来源文件、外部会话元信息、请求级记录、解析告警、刷新结果与五个端点的请求/响应类型，全部使用业务键与展示名，不含内部 `id`；`src/shared/dates.ts` 提供本地时区日期派生、日期加减、合法性校验与含首尾区间枚举，供解析层和服务层共用。

验证：`npm run typecheck` 通过；`npm test` 5 个用例通过（日期派生、跨月加减、区间枚举、日期校验、契约字段可构造且 `RequestRow` 无 `id` 字段）。为验证跨目录引用，新增 `tests/shared.test.ts`，超出本任务修改范围但属共享契约的必要验证。

提交：8db0d06

# T003 派生索引 schema 与版本控制

状态：done

目标：按 data-model 建立六张表、索引与 `meta` 单行，并实现 `schema_version` 不匹配即删库重建。

完成条件：启动后生成 `.data/index.db`；表、列、UNIQUE 与索引和 data-model 一致；人为改低 `schema_version` 后启动会重建而非报错；重建后内部 `id` 允许重新分配。

依赖：T001、T002。

修改范围：`src/etl/`（schema 与连接管理）、`server/index.ts`（启动时打开索引）。

实施结果：`src/etl/config.ts` 解析 `WORKBUDDY_HOME` 与固定索引路径，并提供外部库、projects 根目录定位；`src/etl/index-db.ts` 建立 `groups` / `sessions` / `models` / `source_files` / `requests` / `meta` 六张表、五个查询索引与业务键 UNIQUE，`meta` 以 `CHECK (id = 1)` 保证单行。打开时先探测 `schema_version`，不匹配或文件不可读则关闭连接、删除 `index.db` 及其 `-wal` / `-shm` / `-journal` 后重建，新库直接写入 `last_full_scan_at`。服务启动时打开索引并打印是否重建。

验证：`npm run typecheck` 通过；`npm test` 9 个用例通过，其中索引测试覆盖六张表、`requests` 列顺序、五个索引、`meta` 单行与业务键唯一约束、默认 journal 模式、版本不匹配删库重建且内部 `id` 从 1 重新分配、版本一致时保留数据。手工启动服务生成 `.data/index.db`；用 `node:sqlite` 将 `schema_version` 改为 0 后重启，日志显示「已重建」，`meta.schema_version` 恢复为 1，服务正常监听。

提交：aaac845

# T004 外部数据只读访问与扫描

状态：done

目标：只读打开 `workbuddy.db`，扫描 jsonl 并产出待解析集合，字段映射集中一处。

完成条件：以 `readOnly: true` 打开且写入被拒；能读取 `sessions` / `session_usage`；递归找到 `*.jsonl` 并正确判定 `main` / `subagent`，排除 `.ndjson` 等无关文件；`size_bytes` / `mtime_ms` 取解析前的 stat（C9）。

依赖：T001、T002。

修改范围：`src/etl/`（外部数据源访问与扫描）。

实施结果：`src/etl/external.ts` 以 `readOnly: true` 打开 `workbuddy.db`，集中映射 `sessions`（id / cwd / title / custom_title / model）与 `session_usage.credit_json`，空串归一为 NULL，非法 JSON、非数字积分与重复键分别计数告警；库不存在时返回 `available=false` 的空快照，库存在但读取失败时抛出由刷新层中止。`src/etl/scan.ts` 递归扫描 `projects/**/*.jsonl`，只认 `<编码cwd>/<sessionId>.jsonl` 与 `<编码cwd>/<sessionId>/subagents/<agentId>.jsonl` 两种布局，其余 `.jsonl` 计入 `unrecognizedFiles`；扩展名判断天然排除 `.ndjson`，结果按路径排序，`sizeBytes` / `mtimeMs` 在返回前逐文件 stat（C9）。

验证：`npm run typecheck` 通过；`npm test` 14 个用例通过，覆盖主/子代理判定、排除 `.ndjson` 与 `.txt`、深层无关 `.jsonl` 计数、stat 取值、projects 缺失、会话与积分映射、三类积分告警、库不存在降级、只读连接拒绝 `DELETE` / `INSERT` / `CREATE TABLE`。真实数据扫描：265 个 jsonl（218 主会话 + 47 子代理）、0 个无法归属；读取 251 个会话、477 条积分，无告警。

提交：b3975b7

# T005 逐行解析与按请求归并

状态：done

目标：把 jsonl 事件流归并为请求级记录，落实 C2–C5 口径。

完成条件：不完整行与时间戳非法的行跳过并计入解析告警；同一 `conversationRequestId` 取 `total_tokens` 最大那条的四个同源字段（C2，含非单调反例）；C3 / C4 校验告警可观测；`started_at` / `ended_at` 取全部步骤边界；`date_key` 按本地时区派生；未知字段与未知事件类型不中断解析。

依赖：T004。

修改范围：`src/etl/`（解析与归并）。

实施结果：`src/etl/fields.ts` 集中外部字段映射，只认 `providerData.conversationRequestId` / `model` / `requestModelName` 与 `message.usage` 的四个 token 字段，空对象与缺字段分别处理，未知键忽略。`src/etl/parse.ts` 用 `readline` 流式逐行解析，按请求归并：`total_tokens` 缺失或为 0 时用 `input + output` 兜底，取最大值那条的四项同源字段，`started_at` / `ended_at` 取全部步骤边界，`date_key` 由最早的 `started_at` 按本地时区派生；模型按请求 → 会话 → `未知模型` 三级回退，分组取会话 `cwd`，子代理标记 `is_subagent` 并归入父会话。C3 / C4 校验只告警、保留原值。

验证：`npm run typecheck` 通过；`npm test` 21 个用例通过，覆盖时间末条小于最大值的非单调反例（取 250 而非 180）、四项同源、缺 `total_tokens` 兜底、缓存缺失记 0、C3 / C4 / 零值告警、非法 JSON 与非法时间戳跳过、未知字段与未知事件类型不中断、模型三级回退、子代理归属、重复解析稳定。真实数据解析 265 个文件用时 2.3 秒：30,914 条用量步骤归并为 934 条文件级请求记录，0 个 C3 / C4 违规，2,995 条零 token 步骤，2 行非法 JSON；全局去重（同一 `request_id` 出现在两个文件，数值相同）留待写入层处理。

提交：d5d3bdd

# T006 维表 upsert 与业务键换 id

状态：done

目标：维护 `groups` / `sessions` / `models` / `source_files`，把业务键换成内部外键，落实 C7、C11–C14。

完成条件：四类业务键通过 `INSERT ... ON CONFLICT DO NOTHING` + `SELECT id` 得到唯一行；模型展示名按 C12 规范化且与文件遍历顺序无关；`sessions.display_name` 按 R6 优先级；维表行缺失时按 C13 兜底；外部会话被清理后已有维表行保留（C11）；分组归属按 C7 取解析时刻快照。

依赖：T003、T005。

修改范围：`src/etl/`（维表与关联）。

实施结果：`src/etl/dimensions.ts` 提供 `DimensionWriter`，按业务键 upsert 并在一次刷新内缓存内部 id；分组展示名取路径末段并兼容 POSIX / Windows 分隔符，`未知分组` 独立成行；会话展示名按 `custom_title` → `title` → ID 前 8 位，外部同步只更新仍存在的行，请求侧先建兜底行、后续同步可升级；模型展示名由 `computeModelDisplayNames` 按「含大写且不等于标识、出现次数最多、并列字典序最小」全局计算，写入时只在当前仍是原始标识时升级，避免增量刷新回退；`source_files` 按路径更新扫描状态并返回稳定 id。外部会话同步单独事务提交，维表行不因外部清理而删除（C11）。`UNKNOWN_GROUP` / `UNKNOWN_MODEL` 常量移入 `src/shared/constants.ts` 供解析层与服务层共用。

验证：`npm run typecheck` 通过；`npm test` 30 个用例通过，新增 9 个用例覆盖路径末段（含 Windows）、会话展示名三级优先级、模型高频与并列规则及顺序无关、次数优先于字典序、分组唯一与未知分组、外部会话同步与消失后保留、请求侧兜底行升级、模型展示名稳定与未知模型、来源文件 stat 更新与 id 稳定。

提交：7208979

# T007 文件原子替换与刷新编排

状态：done

目标：实现 C1 / C8 / C9 / C10 的写入语义与一次刷新的互斥编排。

完成条件：变化文件在单一事务内先按 `source_file_id` 删除再插入，请求消失后不残留，同文件其它请求数值不变；`source_files` 状态与事务同提交，解析失败不推进；文件不存在时按 C8 清理对应请求；刷新互斥锁覆盖全流程，并发触发只执行一次；数据无变化时跳过重解析（AC4）；`meta.last_refresh_at` 与刷新返回值正确。

依赖：T003、T006。

修改范围：`src/etl/`（写入与刷新编排）、`server/index.ts`（启动时执行首次刷新）。

实施结果：`src/etl/refresh.ts` 串起完整刷新：只读读取外部快照 → 同步会话/分组维表 → 扫描并按 `size_bytes` + `mtime_ms` 求变化集合 → 对已消失文件在同一事务内删除其请求与 `source_files` 行（C8）→ 逐文件流式解析 → 汇总全部候选后统一计算模型展示名 → 每个变化文件在单一事务内 `ensureSourceFile`、按 `source_file_id` 删除、批量插入请求，`source_files` 状态随事务提交（C9 / C10）→ 更新 `meta.last_refresh_at`。解析或写入失败的文件不推进扫描状态，恢复可读后下次刷新自动重试。跨文件重复请求按 `request_id` upsert 只保留一行，取 `total_tokens` 较大者并计入新增的 `duplicateRequestIds` 告警（R11）。进程内互斥锁覆盖全流程，并发调用等待当前刷新并返回 `skipped: true`。`RefreshResult` 增加 `failedFiles` 以便观察失败文件。服务启动时调用同一刷新入口，并打印扫描文件数、写入请求数、补挂积分条数与耗时。

验证：`npm run typecheck` 通过；`npm test` 38 个用例通过，新增 8 个用例覆盖首次刷新写入、无变化跳过（< 1 秒、零写入）、整文件原子替换且同文件其它请求不变、来源文件删除清理、跨文件重复只保留一行、并发只执行一次、非法 JSON 只告警、解析失败不推进 `source_files` 且恢复后重试成功（C9）。真实数据全量刷新：265 个文件、903 个去重请求、合计 169,749,342 token、耗时 5.6 秒；数据无变化时二次刷新 0 变更、0 写入、耗时 55ms；发现 31 个 `request_id` 同时出现在两个会话文件中（数值相同），已按 R11 只计一次并告警，与 [integration.md](../integration.md) 快照中「跨文件重复为 0」不一致，需在收尾时更新该事实。

提交：f660509

# T008 积分独立挂接

状态：done

目标：把积分挂接做成与文件增量解耦的独立通道（AD-7、C6）。

完成条件：每次刷新无条件重读 `session_usage` 并合成映射；只更新映射中存在的请求（含值修正），映射外不触碰、不主动清零；积分值为 0 时 `has_credit = 1`；jsonl 无变化而积分晚到时能补挂（AC9）。

依赖：T007。

修改范围：`src/etl/`（积分挂接）。

实施结果：`src/etl/credit.ts` 提供 `attachCredits`，在文件写入全部提交后执行，按 `request_id` 条件更新 `credit` 与 `has_credit`；仅当积分值变化或 `has_credit` 仍为 0 时写入，因此值为 0 的记录也会置 `has_credit = 1` 且计入补挂条数。映射外的请求不参与 UPDATE，映射消失时不回写、不清零。刷新流程每次无条件重读 `session_usage`，与文件是否变化无关。

验证：`npm run typecheck` 通过；`npm test` 39 个用例通过，新增用例覆盖首次挂接（1.5 / 0 两种值均置 `has_credit = 1`）、jsonl 无变化时积分晚到补挂与值修正（只更新 2 条，其余不变）、映射消失后已读到的积分与标记保持不变、子代理请求保持无积分记录。真实数据挂接 477 条，合计 5521.28，43 个请求为子代理且全部 `has_credit = 0`；再次刷新 0 条补挂、耗时 48ms。

提交：4e85da5

# T009 服务层 API 与聚合

状态：done

目标：实现 Plan「服务层」与架构文档接口段的五个端点。

完成条件：入参与返回值只用业务键字符串，服务层按业务键过滤（C14）；`from` / `to` 映射为含首尾的 `date_key` 区间（R12）；聚合全部在 SQL，LEFT JOIN 维表取业务键与展示名，维度筛选值取 JOIN 结果的 `DISTINCT`；`timeseries` 固定按天、按模型拆分；`summary` 提供覆盖率所需的 `has_credit` 计数（AC8）；分组求和等于总览（AC3）；生产模式提供静态资源且仅监听 `127.0.0.1`。

依赖：T007、T008。

修改范围：`server/`。

实施结果：`server/query.ts` 以 SQL 完成四个只读端点：`summary` 四项 token、积分、请求数、会话数与 `has_credit` 覆盖率计数；`timeseries` 按 `date_key + model_id` 分组并由 `from` / `to` 补齐连续日期；`breakdown` 按 `group` / `model` / `session` 分组，筛选值来自 JOIN 结果，占比在服务层按 token 与积分分别计算；`requests` 排序在 SQL 完成，返回业务键、展示名与 `hasCredit`。所有筛选参数都是业务键字符串，LEFT JOIN 维表取得业务键与展示名后直接按业务键列过滤，内部 `id` 不出现在响应中（C14）。`server/app.ts` 提供五个端点、参数校验（日期、日期区间、维度、排序字段）与生产模式静态资源；未知 `/api/*` 保持 JSON 404。`server/index.ts` 启动时打开索引、执行首次刷新并监听；`HOST` 只接受回环地址，默认 `127.0.0.1`。

验证：`npm run typecheck` 通过；`npm test` 51 个用例通过，新增 12 个用例覆盖 summary 数值与覆盖率、三维度求和等于总览（AC3）、业务键与展示名、按天按模型序列与日期补齐、四个筛选条件组合、非法参数 400、明细默认排序与积分升序、响应递归不含 `id`（C14）、静态资源与 `/api` 404、刷新入口与 501。真实索引冒烟：`summary` 合计 169,805,366 token、903 个请求、203 个会话、477/903 覆盖率；分组 58 行、模型 11 行、会话 203 行三种拆分的 token 与请求数均等于总览，占比合计为 1。

提交：5fa672c

# T010 面板骨架与四筛选器

状态：done

目标：实现 Spec 行为 1、4、6 的模块结构与筛选联动。

完成条件：Token 与积分两个模块不混排指标，共用时间 / 分组 / 对话 / 模型四个筛选器且无其它开关；默认时间今天；时间粒度只有天；点击分组或模型加入当前模块筛选，点击对话进入明细；面板只渲染 API 结果，不自行求和或换算（AD-4）。

依赖：T009。

修改范围：`src/web/`（布局、筛选状态、路由/视图切换）。

实施结果：`src/web/` 建立面板骨架：`App` 管理唯一一组筛选状态与详情会话，默认今天；`FilterBar` 提供时间（今天 / 近 7 天 / 近 30 天 / 本月 / 全部 / 自定义）、分组、对话、模型四个筛选器与重置，无其它开关，也没有周 / 月粒度；筛选值全部来自 `/api/breakdown` 返回的业务键，且每个维度的选项查询会排除该维度自身，避免选中后无法切换。`ModuleSection` 固定 Token 与积分两个模块，指标不混排。`BreakdownList` 渲染服务端聚合与占比，点击分组 / 模型写入共享筛选并滚回模块，点击对话写入筛选并展示「会话明细」入口条。`useQuery` 只缓存与展示 API 返回值，不做求和或换算。

验证：`npm run typecheck` 与 `npm run build` 通过；生产模式 `npm start` 下首页与 `/api/*` 正常。浏览器实测（Chrome 1280×682 与内置浏览器 499×683）：首屏默认「今天」，四个筛选器与重置按钮排布正常，Token / 积分两模块分列；点击分组 `workbuddy-usage` 后出现筛选 chip、两模块同时收敛为 1 项且数值与占比来自 API；点击对话后出现「会话明细」入口条与退出按钮。图表、指标卡、明细表与刷新入口在 T011 接入。

提交：51b4e69

# T011 面板图表、指标卡与明细

状态：done

目标：实现 Spec 行为 2、3、5、7、8 的呈现与刷新入口。

完成条件：两模块各自的指标卡、按天趋势、四维度分布与占比、请求级明细表齐备；堆叠只按模型着色；积分模块显示覆盖率（AC8）并标注"子代理无本地积分记录"；明细列与排序符合行为 7；刷新入口展示扫描文件数、新增或更新请求数、补挂积分条数与耗时；首屏满足 AC11。

依赖：T010。

修改范围：`src/web/`（图表、表格、刷新交互）。

实施结果：新增 `MetricCards`、`TrendChart`、`EChart`、`RequestTable` 与刷新入口。Token 模块展示合计 / 输入 / 输出 / 缓存命中 / 请求数 / 会话数；积分模块展示积分合计、覆盖率、请求数、无积分记录数，并在模块顶部标注「子代理请求无本地积分记录」。趋势图按 `date_key` 为横轴、每个模型一个堆叠序列，只按模型着色，不按分组或对话着色；`timeseries` 在无起止或仅单边日期时也按数据首末日期补齐连续天，避免空档被压缩。ECharts 按需引入柱状图、网格、图例、提示与 Canvas 渲染器。明细表列为时间、分组、会话标题、模型、输入 / 输出 / 缓存 / 合计 token、积分，时间与五个数值列均可点击切换升降序，默认 Token 模块按合计 token、积分模块按积分降序；子代理请求在会话标题后标注，`has_credit = 0` 显示「无记录」而不是 0。刷新按钮调用 `POST /api/refresh`，完成后显示扫描文件数、新增或更新请求数、补挂积分条数与耗时，并触发全部查询重取。

验证：`npm run typecheck` 与 `npm run build` 通过（按需引入后前端产物 745KB / gzip 245KB）。浏览器实测：首屏默认今天，Token 与积分两模块均具备指标卡、按天趋势、分组 / 对话 / 模型分布与请求级明细；积分模块显示覆盖率 52.8%（477 / 903）与「子代理请求无本地积分记录」提示；「全部」时间下 903 条请求、169,898,659 token，趋势图按模型堆叠着色，明细 903 行按合计 / 积分降序，无记录行显示「无记录」；点击刷新后提示「扫描 265 个文件 · 更新 2 条请求 · 补挂 2 条积分 · 耗时 0.2 秒」，数值随刷新更新。

提交：6b092f2

# T012 集成测试与全量验收

状态：done

目标：用固定 fixture 跑通 AC1–AC11，并执行全量检查。

完成条件：按 Plan「测试策略」执行独立 `tsc --noEmit`、Vitest 单测、`npm run build`；样本 `WORKBUDDY_HOME` 的全量刷新结果逐条核对 AC1–AC11（含多步骤、子代理、无积分记录、文件被移除、会话行缺失等场景）；只读连接写入被拒得到验证；记录每条命令、结果与未执行检查的原因。全量检查结果集中记录在本任务。

依赖：T001–T011。

修改范围：测试目录、全仓检查记录。

实施结果：新增 `tests/acceptance.test.ts`，用固定样本 `WORKBUDDY_HOME` 覆盖 AC1–AC11：7 个请求（含 5 步骤请求、子代理请求、无积分请求、已删除会话请求、外部会话行缺失请求），4 个会话有外部行、1 个会话仅有 jsonl，2 个分组外还有 `未知分组`；断言请求级四项 token、积分、覆盖率、三维度求和、增量刷新、全量重建、子代理归属、移除外部会话行后的分组回退、积分晚到补挂、内容替换与文件移除。AC11 的界面结构通过生产模式人工核对，其余验收项均有自动断言。

验证：

- `npm run typecheck`（`tsc --noEmit`）：通过，0 错误。
- `npm test`：8 个测试文件、63 个用例全部通过（约 2.1 秒）。只读连接对 `DELETE` / `INSERT` / `CREATE TABLE` 均抛错。
- `npm run build`：通过。服务端 tsc 产物 `dist/server/index.js`；前端 `dist/web/` 主包 745.08 kB（gzip 245.11 kB），Vite 提示超过 500 kB，为本地工具可接受，未做代码分割。
- `npm start`：静态首页、`/assets/*` 与五个 API 端点正常；`HOST` 非回环地址时启动即拒绝。
- 真实数据全量重建（删除 `.data/index.db` 后）：265 个文件、903 个去重请求、477 条积分、合计 169,932,908 token，耗时 2.44 秒（AC5 < 30 秒）；无变化二次刷新 0 变更、0 写入、21ms（AC4 < 1 秒）；43 个子代理请求全部 `has_credit = 0`；按请求合计 169,936,540，步骤直接累加 6,750,536,696，约 39.7 倍（AC2 量级成立）。
- AC1：样本 r1（5 步骤）150 / 100 / 50 / 250、积分 1.5；r3（子代理）240 / 160 / 0 / 400、无积分；r7（无积分、会话行缺失）420 / 280 / 0 / 700、分组 `未知分组`，与手算一致。
- AC3：样本总览 2765 token、7 请求；分组 / 模型 / 对话三种拆分的 token 与请求数之和均等于总览，占比合计为 1；真实数据下三种拆分同样等于 169,932,908。
- AC6：样本唯一子代理请求归入父会话与父分组；真实数据 43 个子代理请求均计入且无积分记录。
- AC7：删除 `sess-gamma-0003` 外部行并重新解析后，r5 仍为 500 token，分组变为 `未知分组`，会话维表保留原展示名。
- AC8：样本 3 / 7 覆盖率；真实数据 477 / 903（52.8%），无记录 426。
- AC9：jsonl 未变化时新增一条积分记录，刷新补挂 1 条，`has_credit` 置 1。
- AC10：移除同一文件内的 r2 后该请求消失、r1 数值不变；删除 `sess-delta-0004.jsonl` 后 r6 被清理、其余请求逐字段不变。
- AC11：生产模式下人工核对（Chrome 1280×682）：首屏默认今天；Token 与积分两模块分列；筛选器仅时间、分组、对话、模型与重置；无周 / 月粒度开关；趋势图每个模型一个堆叠序列；积分模块显示覆盖率与「子代理请求无本地积分记录」；刷新后显示扫描文件数、更新请求数、补挂积分条数与耗时。

未执行检查：ESLint 未配置，Plan 标注为非必需（`tsc --noEmit` + Vitest 已覆盖类型与行为）；未引入 jsdom / Testing Library，AC11 结构以人工核对代替自动化 DOM 断言。

快照说明：Spec 的 AC2「约 1:22」与 AC6「快照中的 8 个子代理请求」是 Spec 确认时的样本数字；当前数据已增长到约 39.8 倍与 43 个子代理请求，验收按口径与下界执行，不回写 Spec 数字。

剩余风险：真实数据出现 31 个 `request_id` 同时存在于两个会话文件（数值相同），当前按 R11 只保留一行并把归属记在其中一个来源文件；若该来源文件被删除而副本仍在，需等副本文件变化后才会重新入索引。数据中另有 2,995 条零 token 步骤与 2 行非法 JSON，均已按兜底与告警处理。前端包体偏大，属本地工具可接受范围。

提交：cc2d982

# T013 交付收尾检查与文档同步

状态：done

目标：按 AGENTS.md 第 5 节逐项收尾，保证需求—计划—任务—提交可追踪。

完成条件：Spec 的 AC1–AC11 均满足或已记录剩余风险；各任务状态与实施记录准确完整，已实施任务的提交 hash 统一回填；`product-brief.md`、`technical-architecture.md`、`data-model.md`、`integration.md`、`devops.md` 按实现同步且与代码无已知矛盾；`docs/backlog/` 相关条目已处理；收尾检查结果记录在本任务。

依赖：T012。

修改范围：`docs/`、本文件。

实施结果：T001–T012 的「提交」字段已统一回填（`e6fbdda`、`8db0d06`、`aaac845`、`b3975b7`、`d5d3bdd`、`7208979`、`f660509`、`4e85da5`、`5fa672c`、`51b4e69`、`6b092f2`、`cc2d982`）；T013 为收尾任务，按约定不填提交字段。长期文档按实现同步：`product-brief.md` 补齐请求数与会话数指标，并把步骤累加倍数改为当前实测口径；`technical-architecture.md` 更新 Node 版本、数据规模、全量解析耗时与 AD-2 / AD-8 的实测数字；`data-model.md` 补充 C8 同时删除 `source_files` 行、C12 展示名在增量刷新中保持稳定的行为；`integration.md` 用 2026-11-12 快照替换旧快照，记录 31 个跨文件重复请求与新的 token / 积分 / 会话规模；`devops.md` 更新 Node 安装位置、类型检查与测试命令、首次刷新耗时、`HOST` 回环限制与启动顺序；`usage-stats-plan.md` 的服务层过滤措辞同步修正为 LEFT JOIN 后按业务键过滤。

验证：

- Spec 的 AC1–AC11 均在 T012 有对应结论：AC1、AC2、AC3、AC4、AC5、AC6、AC7、AC8、AC9、AC10 有自动断言；AC11 经生产模式人工核对。剩余风险（跨文件重复请求的归属、零 token 步骤、前端包体）已记录在 T012。
- 任务状态：T001–T013 均为 `done`；T001–T012 的实施结果、验证与提交字段齐全，T013 为收尾任务按约定不填提交字段。任务编号未重排，新增信息只追加。
- 文档同步：五份长期文档已按实际实现更新；检索旧表述（`24.19`、`E:\Software`、`5–15 秒`、`405 个请求`、`22 倍`、`跨文件重复为 0`）在长期文档中已无残留。历史 Spec / Plan 的验收快照数字保留原文不改写；Plan 的服务层过滤措辞已按实际实现修正（LEFT JOIN 后按业务键过滤，不换内部 `id`）。
- `docs/backlog/` 仅有 `.gitkeep`，本次交付没有需要更新、移除或转化的条目；跨文件重复请求的极端场景已作为剩余风险记录，不单独立项。
- 收尾复跑：`npm run typecheck` 通过；`npm test` 8 个文件 / 63 个用例通过；`npm run build` 通过。工作区在本提交前只包含本次文档变更。

说明：按 AGENTS.md 的任务提交规则，T013 的提交 hash 不记录；交付完成后工作区保持干净。
