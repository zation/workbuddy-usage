# 数据模型

本项目不产生业务数据，只读 WorkBuddy 的本地数据，并按统计需要建立一份**可删除重建**的派生索引。外部数据的实际格式（jsonl 字段、`workbuddy.db` 表结构、关联键）见 [integration.md](./integration.md)，本文件只描述本项目自身的模型。

## 设计原则

- **事实表 + 维表**：`requests` 只放度量、外键、时间与审计字段；描述属性（展示名、标题）放维表，用自然键关联。
- **全部表都是派生快照**：从 WorkBuddy 读到后写入，不因外部数据被清理而删除。每次刷新按当前外部数据更新仍存在的行，映射外不触碰（与 C6 积分挂接同构）。
- **维度筛选值取自 `requests` 的 `DISTINCT`**，维表只用于补展示名；因此维表里存在暂时没有请求的行也不影响界面。
- **不建外键约束，查询一律 LEFT JOIN**：外部会话被清理、模型或分组取不到时，维表行可能缺失，需要用兜底值展示，不能丢请求。
- **自然键而非代理键**：`cwd` / `sessionId` / `model` 标识本身就是稳定字符串，再引入 ID 映射只会增加解析与重建成本。

## 核心实体

| 实体 | 粒度 | 键 | 落库 | 说明 |
| --- | --- | --- | --- | --- |
| **Request** | 一次请求 | `request_id` | `requests`（事实表） | 度量 + 外键 + 时间 + 审计字段 |
| **Group** | 工作目录 | `group_path` | `groups`（维表） | 取值 `sessions.cwd`，旧称"项目" |
| **Session** | 一次连续对话 | `session_id` | `sessions`（维表） | 子代理归入父会话；存放展示名 |
| **Model** | 模型标识 | `model` | `models`（维表） | 存放规范化后的展示名 |
| **SourceFile** | 一个 jsonl 文件 | `path` | `source_files`（维表 + 扫描状态） | 增量判断与对账 |
| **Step** | 请求内一次模型调用 | — | 否 | 解析期归并后丢弃 |
| **Credit** | 一个请求一条 | — | 否 | 内联为 `requests.credit` / `has_credit` |

**分组维度的取值是 `sessions.cwd`**，不是 `sessions.group_id` / `group_title`；后两者是 WorkBuddy 会话表里的其它字段，本项目不读取。

## 表结构

### `requests`（事实表）

主键 `request_id`，一行代表一个请求的全部消耗。四个 token 字段、积分、时间与审计信息是度量/事实；`group_path` / `session_id` / `model` / `source_file` 是指向维表的自然键外键。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `request_id` | TEXT PK | `conversationRequestId`，全局唯一，幂等键 |
| `session_id` | TEXT NOT NULL | → `sessions.session_id`；子代理请求填**父会话** ID |
| `group_path` | TEXT NOT NULL | → `groups.group_path`；解析时的 `sessions.cwd` 快照，取不到为 `未知分组` |
| `model` | TEXT NOT NULL | → `models.model`；缺失为 `未知模型` |
| `is_subagent` | INTEGER NOT NULL DEFAULT 0 | 是否来自 `subagents/agent-*.jsonl`；请求级标记，同一父会话内主/子请求混在一起，不能移到维表 |
| `started_at` | INTEGER NOT NULL | 该请求所有步骤中最早的 `timestamp`（毫秒） |
| `ended_at` | INTEGER NOT NULL | 该请求所有步骤中最晚的 `timestamp`（毫秒） |
| `date_key` | TEXT NOT NULL | 由 `started_at` 按本地时区派生的 `YYYY-MM-DD` |
| `input_tokens` | INTEGER NOT NULL DEFAULT 0 | 输入 token |
| `output_tokens` | INTEGER NOT NULL DEFAULT 0 | 输出 token |
| `cache_read_tokens` | INTEGER NOT NULL DEFAULT 0 | 缓存命中读取 token（输入的子集） |
| `total_tokens` | INTEGER NOT NULL DEFAULT 0 | 合计 token |
| `credit` | REAL NOT NULL DEFAULT 0 | 积分；无记录为 0，非 NULL |
| `has_credit` | INTEGER NOT NULL DEFAULT 0 | 是否存在积分记录；有记录为 1（含积分值为 0），无记录为 0。用于覆盖率计数，不能用 `credit > 0` 代替 |
| `step_count` | INTEGER NOT NULL DEFAULT 1 | 该请求归并了多少条步骤记录，审计用 |
| `source_file` | TEXT NOT NULL | → `source_files.path`；重解析该文件时以它为单位原子替换 |

`started_at` / `ended_at` 独立取自全部步骤的时间边界，与四项 token 的取值来源（C2）无关。

索引：`date_key`、`group_path`、`model`、`session_id` 各建普通索引，覆盖时间过滤与三个维度的拆分；`source_file` 建普通索引，支撑按文件删除与对账。

### `groups`（分组维表）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `group_path` | TEXT PK | `sessions.cwd` 原值；`未知分组` 也作为一行 |
| `display_name` | TEXT NOT NULL | 路径末段，用于界面；重名时界面可回退完整路径 |

### `sessions`（会话维表）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | TEXT PK | 父会话 ID；子代理会话不单独建行 |
| `custom_title` | TEXT | 用户自定义标题 |
| `title` | TEXT | 自动生成标题 |
| `display_name` | TEXT NOT NULL | 按 `custom_title` → `title` → `session_id` 前 8 位 算好的展示名 |
| `synced_at` | INTEGER | 最近一次从外部库同步的时间（毫秒） |

维表是快照：外部 `sessions` 行消失后保留原值，避免历史请求的对话名突然变成 ID。

### `models`（模型维表）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `model` | TEXT PK | `providerData.model` 标识；`未知模型` 也作为一行 |
| `model_name` | TEXT | 规范化后的展示名 |
| `display_name` | TEXT NOT NULL | `model_name` 缺失时回退 `model` |

**展示名必须规范化**：实测同一个 `model` 标识会对应多个不同的 `requestModelName`（如 `deepseek-v4.1-flash` 同时出现 `DeepSeek-V4.1-Flash`、`Deepseek-V4.1-Flash` 和全小写标识本身）。写入规则：先筛出含大写且不等于 `model` 标识的候选，取其中出现次数最多、并列时字典序最小的一个；没有候选则回退 `model` 标识。结果只取决于候选集合，与文件遍历顺序无关，重复解析稳定。

### `source_files`（扫描状态表 / 来源维表）

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

### `meta`（单行配置表）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PK CHECK (id = 1) | 恒为 1，保证只有一行 |
| `schema_version` | INTEGER NOT NULL | 派生库结构版本 |
| `last_refresh_at` | INTEGER | 最近一次刷新完成时间（毫秒） |
| `last_full_scan_at` | INTEGER | 最近一次全量重建时间（毫秒） |

这三项原先用 key/value 行存放，但键集合固定、值都是整数或时间戳，改成固定列后类型明确、一次读完、不需要把 INTEGER 塞进 TEXT。表结构变化由 `schema_version` 兜底（不匹配即删库重建），因此加列没有迁移成本。

## 关系

```text
groups   1 ──┐
sessions 1 ──┼──< requests >── 1 source_files
models   1 ──┘
```

自然键外键：`requests.group_path` → `groups.group_path`、`session_id` → `sessions.session_id`、`model` → `models.model`、`source_file` → `source_files.path`。**不建外键约束**，查询用 LEFT JOIN；维表只提供展示名，维度筛选值从 `requests` 的 `DISTINCT` 取。

- 一个请求恰好属于一个会话；子代理请求归属其父会话，因此对话维度的会话数不会因父子拆分而虚增。
- 一个请求至多一条积分；无记录时为 0，不用 NULL 表达"缺失"，以免聚合时与"0 积分"混淆——是否缺失由 `has_credit` 单独标记，覆盖率按该列计数。
- 一个请求可有多条步骤（当前约 91% 的请求），但只落一行。
- 维表行可能滞后或缺失：外部会话被清理、模型标识为 `未知模型` 时，仍要展示请求本身。

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
- **C11 维表是快照**：`groups` / `sessions` / `models` 由本项目维护，写入后不因外部数据被清理而删除；每次刷新按当前外部数据更新仍存在的行，映射外不触碰。维表残留行不参与筛选枚举。
- **C12 展示名确定**：`models.display_name` 与 `sessions.display_name` 必须由与文件遍历顺序无关的规则得出（见各表说明），保证重复解析结果稳定。
- **C13 兜底**：维表行缺失时，分组 / 对话 / 模型展示分别回退为 `未知分组` / `session_id` 前 8 位 / `model` 标识，不丢弃请求。

## 生命周期

1. **扫描**：递归查找 `projects/**/*.jsonl`，按路径判定 `main` / `subagent`，与 `source_files` 比对解析前 stat 的 `size_bytes` + `mtime_ms`（C9），得出待解析集合。
2. **外部元信息同步**：重读 `sessions` 表，按当前行 upsert `sessions` / `groups` 维表（C11）；映射外不触碰、不删除。
3. **解析**：逐行读取，跳过不完整行与时间戳非法的行；按 `conversationRequestId` 归并步骤，套用 C2 选出最大值那条，得到请求级记录。
4. **关联**：用 `session_id` 挂会话与 `group_path`；从 `providerData` 提取 `model` / `requestModelName`，按 C12 规范化后 upsert `models` 维表。
5. **写入**：对每个待解析文件按 C10 在事务内原子替换其请求行，再更新 `source_files` 的扫描状态。
6. **积分挂接**：与文件增量无关，每次刷新无条件重读 `session_usage`，按 C6 只更新当前映射中存在的请求。
7. **查询**：服务层对 `requests` 做 LEFT JOIN 取展示名，按维度聚合与时序聚合用 SQL 现算，不预物化；维度筛选值从 `requests` 的 `DISTINCT` 取。
8. **失效**：删除 `.data/index.db` 即可回到初始状态，下次启动全量重建；不涉及迁移与数据修复。

## 数据库结构与迁移

- **外部库 `workbuddy.db`**：WorkBuddy 所有，本项目以只读连接访问，不建表、不写入、不加锁。其表结构变化由 [integration.md](./integration.md) 记录并跟踪。
- **派生库 `.data/index.db`**：本项目所有，sqlite 单文件，位于仓库目录内并在 `.gitignore` 中排除。仅作缓存，不承担数据安全责任。
- **版本管理**：`meta.schema_version` 记录结构版本。修改表结构时递增该值，启动时版本不匹配则直接删库重建，不写迁移脚本——重建成本是几十秒，迁移脚本的维护成本更高。
- **不做**：不备份原始数据、不归档历史快照、不与云端同步、不追溯补齐本地已不可读的记录。
