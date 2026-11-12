# 用量统计 Plan

## 现状分析

- 仓库目前只有 `AGENTS.md` 与 `docs/` 下的长期文档、本交付的 Spec；**没有任何代码、依赖或构建配置**。
- [usage-stats-spec.md](./usage-stats-spec.md) 已确认：业务规则 R1–R13、已确认决策、验收标准 AC1–AC11 可直接作为实现与验收依据，本 Plan 不重复其正文。
- 外部数据格式、数据可得性与兼容性风险见 [integration.md](../../integration.md)；派生库表结构与约束 C1–C14 见 [data-model.md](../../data-model.md)；分层、接口与架构决策 AD-1–AD-8 见 [technical-architecture.md](../../technical-architecture.md)；运行方式见 [devops.md](../../devops.md)。
- 实测基线：jsonl 约百余个、百 MB 级，归并后数百个请求，维度规模 9 个模型 / 65 个分组 / 98 个有请求的会话。全量解析约 5–15 秒，增量刷新是硬要求。
- 已定边界：外部数据只读、不联网、派生索引可删重建；Node ≥ 24，依赖实验性的 `node:sqlite`；v1 不做字段别名表、不上 worker、不补 `/api/summary` 新鲜度元数据、不提供导出与鉴权。

## 技术方案

### 目录与分层

| 目录 | 职责 |
| --- | --- |
| `src/shared/` | 类型定义：解析结果、API 契约，供 ETL 与面板共用（AD-1） |
| `src/etl/` | 扫描、逐行解析、维表 upsert、积分挂接、刷新编排 |
| `server/` | Hono + `@hono/node-server`：聚合 SQL、HTTP API、生产模式静态资源 |
| `src/web/` | React + ECharts 面板 |
| `.data/index.db` | 派生索引，`.gitignore` 排除 |

依赖：`typescript`、`@types/node`、`vite`、`@vitejs/plugin-react`、`react`、`react-dom`、`echarts`、`hono`、`@hono/node-server`、`vitest`；开发模式用 `concurrently` 同时启动 Vite 与 API，Vite proxy 转发 `/api`。不引入 ORM 与状态管理库。

### 索引层

- 启动时建表（`CREATE TABLE IF NOT EXISTS`）与索引，写入 `meta` 单行；先读 `schema_version`，与当前版本不符则删除库文件全量重建。
- 表：`requests`、`groups`、`sessions`、`models`、`source_files`、`meta`，列与约束严格按 [data-model.md](../../data-model.md)；业务键 UNIQUE、内部 `id` 自增。
- 派生库用默认 journal 模式（单进程读写）。`node:sqlite` 是同步 API，刷新期间同进程的 API 请求会排队；v1 接受，用进程内互斥锁 + 面板 loading 缓解。
- 外部库始终 `new DatabaseSync(path, { readOnly: true })`；WAL 只读连接依赖 `-wal` / `-shm`。

### 解析层

1. **扫描**：递归找 `*.jsonl`，按路径判定 `main` / `subagent`，排除 `.ndjson` 与其它文件；**解析开始前**取 `size_bytes` / `mtime_ms`（C9）。
2. **逐行解析**：`readline` 逐行，`JSON.parse` 失败跳过并计入 `parseErrors`；字段映射集中一处，只认 integration.md 记录的实测字段；未知事件类型忽略。
3. **归并**：按 `conversationRequestId` 聚合步骤，取 `total_tokens` 最大那条的四个 token 字段（C2），校验 C3 / C4；首末时间戳取全部步骤边界；按本地时区派生 `date_key`（C5）；收集模型展示名候选。
4. **关联**：业务键（`session_key` / `cwd` / `model` / `path`）走 `INSERT ... ON CONFLICT DO NOTHING` + `SELECT id` 换内部外键（C14）；展示名按 C12 规范化；子代理请求归入父会话。
5. **写入**：每个待解析文件在**同一事务内**先 `DELETE WHERE source_file_id = ?` 再批量插入本次解析结果（C10），并更新该文件的 `source_files` 扫描状态。事务失败则扫描状态不推进，下次刷新必然重试。
6. **积分挂接**：与文件增量无关，每次刷新无条件重读 `session_usage` 合成 `requestId → 积分` 映射，只 `UPDATE` 映射中存在的请求；映射外不触碰、不主动清零（C6）。
7. **刷新编排**：进程内互斥锁覆盖"扫描 → 元信息同步 → 解析 → 关联 → 写入 → 积分挂接 → 更新 `meta.last_refresh_at`"全程；返回扫描文件数、新增或更新请求数、补挂积分条数、耗时。

### 服务层

- 端点与参数按 [technical-architecture.md](../../technical-architecture.md) 接口段：`/api/summary`、`/api/timeseries`、`/api/breakdown`、`/api/requests`、`/api/refresh`。
- 入参一律业务键字符串：服务层用 LEFT JOIN 维表后按业务键过滤（不换成内部 `id`），`from` / `to` 映射为 `date_key` 范围（含首尾）；返回值也不含内部 `id`（C14）。
- 聚合全部在 SQL：`SUM` 四项 token 与积分、`COUNT(DISTINCT session_id)`、`SUM(has_credit)` 算覆盖率；`breakdown` / `timeseries` 按维度 `GROUP BY`，LEFT JOIN 维表取业务键与展示名；明细排序在 SQL 完成。维表缺失行按 C13 兜底。
- 生产模式由 `@hono/node-server` 提供静态资源；监听 `HOST=127.0.0.1`，不改为 `0.0.0.0`。

### 面板层

- Token 与积分两个模块，共用一组四个筛选器（时间 / 分组 / 对话 / 模型），默认今天；时间粒度固定按天，堆叠只按模型着色（Spec 行为 1–5）。
- 每个模块：指标卡、按天趋势、四维度分布与占比、请求级明细表、手动刷新入口（行为 2/3/7/8）。
- 只渲染 API 返回值，不自行求和或换算（AD-4）；筛选值从 API 提供的业务键列表取。

### 一次刷新的执行顺序（正确性约束）

以下顺序影响正确性或兼容性，实现时不得调换：

1. 先建索引层 schema 与 `meta`，再实现解析层——写入目标必须先存在。
2. 单次刷新内：**文件原子替换写入完成、请求行落定之后**才做积分挂接，否则 `UPDATE` 找不到目标行。
3. `source_files` 的 stat 更新必须与该文件的事务同提交；解析失败不得推进扫描状态。
4. 刷新互斥锁覆盖全流程，避免两个刷新交错导致同一文件被替换两次。
5. 服务层在 ETL 能稳定产出请求行之后实现；面板最后实现，且不得自带口径。
6. 改表结构时**先递增 `schema_version` 再改 DDL**，否则旧索引不会触发重建。
7. 修改字段映射或归并逻辑后，删除 `.data/index.db` 重建再验收；切换 `WORKBUDDY_HOME` 同样先删索引。

### 关键取舍

| 选择 | 理由 | 代价 |
| --- | --- | --- |
| 全 TypeScript 单仓 | AD-1，类型贯通解析到面板 | 需 node_modules 与构建步骤 |
| 以请求为核算单位 | AD-2，积分与 token 在该粒度对齐 | 必须按 `conversationRequestId` 归并 |
| sqlite 派生索引 | AD-3，增量替换 / 聚合 / 排序一条 SQL 覆盖 | 依赖实验性 `node:sqlite`，升级主版本需回归 |
| 服务层聚合 | AD-4，避免明细全量下发 | 端点随下钻增加 |
| 事实表 + 维表 + 内部代理主键 | AD-8，外部标识不稳定、避免绑架主键 | 查询需 JOIN；内部 `id` 不外露 |
| 积分独立刷新通道 | AD-7，`credit_json` 与 jsonl 写入时机不同步 | 每次刷新多读约百行 |
| 按文件原子替换 | C10，防止请求消失后旧行残留 | 变化即整文件重解析 |
| `date_key` 落库 | C5 / AD-6，把本地时区口径固化一次 | 一列冗余 |
| 同步 `DatabaseSync`，不上 worker | 单机单用户、手动刷新，实现最简单 | 刷新 5–15 秒期间 API 排队；互斥锁 + loading 缓解 |
| 不做字段别名表 | 单一数据源、实测字段固定 | 格式变化时需改解析层一处 |
| 不补齐本地已不可读的数据 | Spec 已确认 | 积分覆盖率 < 100%，界面需标注 |
| 同名自定义模型暂合并 | 原始日志无可区分字段，用户拍板不预留额外列 | 已知限制，待 WorkBuddy 提供来源字段再扩展 |

## 影响范围

- 新增：`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`src/shared/`、`src/etl/`、`server/`、`src/web/`、测试文件、`.env.local`（不入库）。
- 不改动：`AGENTS.md`（模板同步维护，禁止手改）、`~/.workbuddy` 下任何文件、WorkBuddy 配置。
- 无网络调用、无数据库服务、无容器；单机单进程。
- 文档：实现若改变事实，需同步 `technical-architecture.md`、`data-model.md`、`integration.md`、`devops.md` 与产品简报。

## 数据与接口变化

- 派生库新增六张表（见 [data-model.md](../../data-model.md)），全为可删重建的派生数据；`meta.schema_version` 控制重建。
- 新增本地 HTTP API 五个端点（见架构文档接口段）；除 `POST /api/refresh` 写派生索引外全部只读。
- API 参数与返回值只用业务键；内部 `id` 不出现在 URL、缓存或面板状态。
- 不新增任何外部数据源，也不向 WorkBuddy 写入数据。

## 兼容与迁移方案

- **派生库**：不写迁移脚本；`schema_version` 不匹配直接删库重建，重建成本几十秒。切换 `WORKBUDDY_HOME` 前先删索引。
- **外部格式变化**：字段映射集中在解析层一处；忽略未知事件类型；非数字积分按无记录处理并告警；用"时间末条是否仍为最大值"自检累计语义是否变化。
- **Node 升级**：`node:sqlite` 仍为实验性 API 且主版本间有改名，升级前回归解析与查询；`engines` 保持 `>=24`。
- **WAL**：WorkBuddy 运行时 `-wal` / `-shm` 存在，实测只读连接可用且不改动文件；`-shm` 缺失时的行为未实测，见风险段。
- **回滚**：`git revert` 或切回上一提交后重新 `npm install` 并删索引重建，无外部状态需要清理。

## 测试策略

- **类型检查是独立必需项**：`tsc --noEmit`，不得被 lint、构建或测试代替。
- **Vitest 单测**（按约束编号组织，覆盖主要路径与已发现的反例）：
  - C1 / C10 请求唯一与原子替换（请求消失不残留、同文件其它请求不变、重复解析不产生重复行）。
  - C2 取 `total_tokens` 最大那条，含"时间末条小于最大值"的非单调反例；四项同源。
  - C3 / C4 恒等校验与告警分支；C5 本地时区日期、跨零点请求、时间戳非法跳过。
  - C6 积分晚到补挂、映射外不触碰、积分值为 0 时 `has_credit = 1`。
  - C7 分组快照（会话清理后未重解析保留原值、重解析后指向 `未知分组`）；C8 文件消失按来源删除对应请求。
  - C9 解析前 stat 快照；C11 外部会话清理后维表行保留。
  - C12 展示名规范化（多种写法、频次、字典序、与遍历顺序无关）。
  - C13 维表缺失兜底；C14 业务键换 `id` 与"内部 `id` 不出 API"。
  - 刷新互斥锁：并发触发只执行一次。
- **集成测试**：用样本 `WORKBUDDY_HOME`（固定 jsonl 夹具 + 只读 db 夹具）跑全量刷新，逐条核对 AC1–AC11；包含子代理请求、已删除会话、无积分记录、文件被移除等场景。
- **构建与静态检查**：`npm run build`、`npm run lint`（若配置 ESLint）；ESLint 非必需，`tsc --noEmit` + Vitest 已覆盖类型与行为。
- **只读验证**：断言只读连接写入被拒。原「刷新后比对 `~/.workbuddy` 文件 mtime」验收项已从 Spec 删除，不再执行——WorkBuddy 运行时自身会持续写文件，无法归因；只读仍是系统边界约束。
- 每次任务记录实际执行的命令与结果，未执行的检查注明原因。

## 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
| --- | --- | --- |
| 统计口径实现错误 | 数字不可复算 | 单测覆盖 C2/C3/C6/C7/C8/C10/C11，集成测试核对 AC1–AC3；删 `.data/index.db` 重建 |
| 刷新阻塞事件循环 | 刷新期间 API 排队 | v1 接受；互斥锁 + loading；后续可上 worker |
| WorkBuddy 运行中追加写 | 读到半行、漏新增行 | 跳过不完整行，C9 取解析前 stat，下次刷新补齐 |
| 会话被清理 / 子代理无积分 | 覆盖率不足 100% | 界面展示覆盖率与"子代理无本地积分记录"，不补齐 |
| `-shm` 缺失时只读打开失败（未实测） | 无法读取 `workbuddy.db` | 提示先启动 WorkBuddy 后重试；实现时补充实测 |
| `node:sqlite` API 变化 | 升级 Node 后解析或查询失败 | 锁 24 LTS 验证，升级主版本前回归 |
| 外部数据格式变化 | 解析结果偏差 | 集中字段映射 + 兼容性风险表；删索引重建后验收 |
| 版本回退 | 派生索引与新代码不匹配 | 回退代码、重新 `npm install`、删索引重建 |
