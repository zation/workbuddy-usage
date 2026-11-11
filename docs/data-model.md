# 数据模型

本项目不产生业务数据，只读 WorkBuddy 的本地数据，并按统计需要建立一份**可删除重建**的派生索引。外部数据的实际格式（jsonl 字段、`workbuddy.db` 表结构、关联键）见 [integration.md](./integration.md)，本文件只描述本项目自身的模型。

## 核心实体

| 实体 | 粒度 | 来源 | 是否落库 |
| --- | --- | --- | --- |
| **Group** | 工作目录 | `sessions.cwd` | 否，以 `requests.group_path` 冗余保存 |
| **Session** | 一次连续对话 | `sessions` 表 + jsonl 文件 | 否，启动时读入内存（百余行） |
| **Request** | 一次请求 | jsonl 按 `conversationRequestId` 归并 | 是，事实表 |
| **Step** | 请求内一次模型调用 | jsonl 单条带 `usage` 的记录 | 否，仅解析期存在 |
| **Credit** | 一个请求一条 | `session_usage.credit_json` | 否，内联为 `requests.credit` / `has_credit` |
| **Model** | 模型标识 | `providerData.model` | 否，内联为 `requests.model` |

**分组维度的取值是 `sessions.cwd`**，不是 `sessions.group_id` / `group_title`；后两者是 WorkBuddy 会话表里的其它字段，本项目不读取。

只有 Request 需要独立存储：Group、Model 是它的字符串属性，Credit 与它一对一，Step 只在归并时用到，Session 的元信息由外部库实时提供。

## 字段

### `requests`（请求表，唯一事实表）

主键 `request_id`，一行代表一个请求的全部消耗。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `request_id` | TEXT PK | `conversationRequestId`，全局唯一，幂等键 |
| `session_id` | TEXT NOT NULL | 归属会话；子代理请求填**父会话** ID |
| `is_subagent` | INTEGER NOT NULL DEFAULT 0 | 是否来自 `subagents/agent-*.jsonl` |
| `group_path` | TEXT NOT NULL | 解析时的 `sessions.cwd` 快照；取不到为 `未知分组` |
| `model` | TEXT NOT NULL | 请求级模型标识；缺失为 `未知模型` |
| `model_name` | TEXT | 取自 `providerData.requestModelName` 的展示名，用于界面 |
| `started_at` | INTEGER NOT NULL | 该请求所有步骤中最早的 `timestamp`（毫秒） |
| `ended_at` | INTEGER NOT NULL | 该请求所有步骤中最晚的 `timestamp`（毫秒） |
| `date_key` | TEXT NOT NULL | 由 `started_at` 按本地时区派生的 `YYYY-MM-DD` |
| `input_tokens` | INTEGER NOT NULL DEFAULT 0 | 输入 token |
| `output_tokens` | INTEGER NOT NULL DEFAULT 0 | 输出 token |
| `cache_read_tokens` | INTEGER NOT NULL DEFAULT 0 | 缓存命中读取 token（输入的子集） |
| `total_tokens` | INTEGER NOT NULL DEFAULT 0 | 合计 token |
| `credit` | REAL NOT NULL DEFAULT 0 | 积分；无记录为 0，非 NULL |
| `has_credit` | INTEGER NOT NULL DEFAULT 0 | 是否存在积分记录；有记录为 1（含积分值为 0），无记录为 0。用于覆盖率计数，不能用 `credit > 0` 代替；只统计本地此刻能读到的记录 |
| `step_count` | INTEGER NOT NULL DEFAULT 1 | 该请求归并了多少条步骤记录 |
| `source_file` | TEXT NOT NULL | 贡献该请求的 jsonl 路径；重解析该文件时以它为单位原子替换 |

`started_at` / `ended_at` 独立取自全部步骤的时间边界，与四项 token 的取值来源（C2）无关。

索引：`date_key`、`group_path`、`model`、`session_id` 各建普通索引，覆盖时间过滤与三个维度的拆分；`source_file` 建普通索引，支撑按文件删除与对账。

### `source_files`（扫描状态表）

用于增量判断，一行一个 jsonl 文件。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `path` | TEXT PK | 文件绝对路径 |
| `kind` | TEXT NOT NULL | `main` 或 `subagent` |
| `session_id` | TEXT NOT NULL | 归属会话 ID（子代理为父会话） |
| `sub_session_id` | TEXT | 子代理自身的 `sessionId`，主会话为 NULL |
| `size_bytes` | INTEGER NOT NULL | 上次解析时的文件大小 |
| `mtime_ms` | INTEGER NOT NULL | 上次解析时的修改时间（毫秒） |
| `parsed_at` | INTEGER NOT NULL | 解析完成时间（毫秒） |

`size_bytes` 与 `mtime_ms` 同时未变则跳过该文件；任一变化则整文件重解析（单文件最大约 1MB，重解析成本可忽略，不需要记录行偏移）。

### `meta`（元信息表）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `key` | TEXT PK | 配置项名 |
| `value` | TEXT NOT NULL | 值 |

约定键：`schema_version`（派生库结构版本）、`last_refresh_at`（最近一次刷新完成时间）、`last_full_scan_at`（最近一次全量重建时间）。

### 不落库的实体

- **Step**：解析期间按 `conversationRequestId` 归并，四项 token 取自 `total_tokens` 最大那条（C2），首末时间戳取所有步骤的时间边界，其余步骤随后丢弃。`requests.step_count` 保留步骤数量用于自检。
- **Session**：`id`、`title`、`custom_title`、`cwd`、`model` 在启动时一次性读入内存，供展示与维度补全；不写入派生库，避免出现与外部库不同步的副本。`sessions.deleted_at` 不参与过滤。
- **Group / Model**：作为字符串维度存在，不做维表。

## 关系

```text
Group 1 ──< Request >── 1 Session          （group_path / session_id）
                 │
                 ├── 1 Credit                 （内联为 credit / has_credit，独立刷新通道）
                 ├── 1 Model                  （内联为 model 列）
                 └──< Step                    （解析期归并，取最大值那条）
```

- 一个请求恰好属于一个会话；子代理请求归属其父会话，因此对话维度的会话数不会因父子拆分而虚增。
- 一个请求至多一条积分；无记录时为 0，不用 NULL 表达"缺失"，以免聚合时与"0 积分"混淆——是否缺失由 `has_credit` 单独标记，覆盖率按该列计数。
- 一个请求可有多条步骤（当前约 91% 的请求），但只落一行。

## 约束

- **C1 请求唯一**：`request_id` 主键，一个请求只落一行；重复解析同一文件由 C10 的原子替换保证不产生重复行。
- **C2 取 `total_tokens` 最大那条而非求和**：四个 token 字段必须取自同一条步骤记录，不得各字段分别取最大值，否则会出现"输入来自第 7 步、输出来自第 3 步"的拼接错误。按时间排序的最后一条**不一定**是最大值那条（实测存在反例，见 [integration.md](./integration.md)），因此口径中的"末步"一律指数值最大那条，不按时间戳取末条。
- **C3 token 恒等**：`total_tokens = input_tokens + output_tokens`（约 7000 条原始记录零例外），写入前校验，不等则记录告警并保留原值。
- **C4 缓存归属**：`cache_read_tokens ≤ input_tokens`（零例外），缓存命中是输入的子集，不额外计入合计。
- **C5 日期派生**：`date_key` 只能由 `started_at` 派生，不单独维护，避免两处不一致；时间戳缺失或非数字的步骤直接跳过并计入解析告警，不生成"未知日期"。
- **C6 积分取值**：`credit` 直接取 `credit_json[request_id]`，有记录时 `has_credit = 1`（即使值为 0），缺失时 `credit = 0` 且 `has_credit = 0`；不做比例分摊、不做金额换算。每次刷新无条件重读 `session_usage`，只更新当前映射中存在的请求（含值的修正）；映射外的请求行不触碰、不主动清零。本地已不可读的记录不追溯补齐。
- **C7 分组快照**：`group_path` 在解析时从 `sessions.cwd` 写入，是解析时刻的快照，不随外部库变化自动刷新。会话被清理后，未重新解析该文件的请求仍保留原值；该文件被重新解析而会话已不存在时，回退为 `未知分组`。
- **C8 对账**：`source_files` 中记录的文件若已不存在，删除 `source_file` 等于该路径的请求行；文件仍在但内容变化时由 C10 原子替换，不残留已消失的请求。反过来，`requests` 中不应出现 `source_files` 之外的文件来源。
- **C9 增量快照**：`source_files` 的 `size_bytes` / `mtime_ms` 必须取**解析开始前**的 stat 值，不能用解析结束时的值，否则会跳过解析期间追加的行。
- **C10 按文件原子替换**：重解析某文件时，在同一事务内先删除 `source_file` 等于该路径的所有请求行，再插入本次解析出的请求；不得只做 upsert，否则文件回滚、截断或重写后已消失的请求会永久残留。前提是一个请求只归属一个文件（实测跨文件重复为 0）；若发现同一 `request_id` 出现在多个文件，记录告警，同一 `request_id` 只保留一行。

## 生命周期

1. **扫描**：递归查找 `projects/**/*.jsonl`，按路径判定 `main` / `subagent`，与 `source_files` 比对解析前 stat 的 `size_bytes` + `mtime_ms`（C9），得出待解析集合。
2. **解析**：逐行读取，跳过不完整行与时间戳非法的行；按 `conversationRequestId` 归并步骤，套用 C2 选出最大值那条，得到请求级记录。
3. **关联**：用 `session_id` 挂会话与 `group_path`，用 `providerData.model` 挂模型（缺失时回退会话模型）。
4. **写入**：对每个待解析文件按 C10 在事务内原子替换其请求行，再更新 `source_files` 的扫描状态。
5. **积分挂接**：与文件增量无关，每次刷新无条件重读 `session_usage`，按 C6 只更新当前映射中存在的请求。
6. **查询**：按维度聚合与时序聚合在查询时用 SQL 现算，不预物化，避免筛选条件组合爆炸。
7. **失效**：删除 `.data/index.db` 即可回到初始状态，下次启动全量重建；不涉及迁移与数据修复。

## 数据库结构与迁移

- **外部库 `workbuddy.db`**：WorkBuddy 所有，本项目以只读连接访问，不建表、不写入、不加锁。其表结构变化由 [integration.md](./integration.md) 记录并跟踪。
- **派生库 `.data/index.db`**：本项目所有，sqlite 单文件，位于仓库目录内并在 `.gitignore` 中排除。仅作缓存，不承担数据安全责任。
- **版本管理**：`meta.schema_version` 记录结构版本。修改表结构时递增该值，启动时版本不匹配则直接删库重建，不写迁移脚本——重建成本是几十秒，迁移脚本的维护成本更高。
- **不做**：不备份原始数据、不归档历史快照、不与云端同步、不追溯补齐本地已不可读的记录。
