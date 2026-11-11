# 外部数据源集成

本项目的数据全部来自 WorkBuddy 的本地运行数据，**只读、不写、不备份**。本文件记录这些外部数据的实际格式，供解析层实现与后续兼容性判断使用。

## 数据源清单

| 来源 | 路径 | 内容 | 访问方式 |
| --- | --- | --- | --- |
| 会话事件流 | `~/.workbuddy/projects/<编码cwd>/<sessionId>.jsonl` | 消息、工具调用、token 用量 | 逐行读取 |
| 子代理事件流 | `~/.workbuddy/projects/<编码cwd>/<sessionId>/subagents/agent-<uuid>.jsonl` | 子代理的独立对话与用量 | 逐行读取 |
| 本地库 | `~/.workbuddy/workbuddy.db` | 会话元信息、积分、工作区 | SQLite 只读连接 |

`~/.workbuddy/usage-log.json` 只记录 skill 与 MCP 的使用天数，与 token / 积分无关，**不读取**。

## 目录布局

```text
~/.workbuddy/
├── projects/
│   └── e-Project-workbuddy-usage/          ← cwd 的有损编码
│       ├── 0240ed2b-....jsonl              ← 主会话
│       ├── 0240ed2b-....file-rollback.ndjson  ← 文件回滚记录，无关
│       └── 0240ed2b-..../                  ← 会话 ID 同名目录，仅子代理使用
│           └── subagents/
│               └── agent-13bd1e0d-....jsonl ← 子代理会话
└── workbuddy.db
```

目录名是 cwd 的有损编码（盘符小写、非字母数字替换为 `-`），例如 `e-Project-workbuddy-usage` 对应 `E:/Project/workbuddy-usage`。**不可反向解码**，分组维度一律取 `sessions.cwd`。

## 会话事件流（jsonl）

每行一个完整 JSON 事件，无外层数组。文件为百余个，分主会话与子代理会话两类，具体数量见文末实测快照。

### 事件类型

| `type` | 是否带 `usage` | 说明 |
| --- | --- | --- |
| `message` | 是 | 模型回复正文（正文可能被裁剪），带最终用量 |
| `function_call` | 是 | 工具调用，每次调用带一次累计用量 |
| `reasoning` | 否 | 思考过程 |
| `function_call_result` | 否 | 工具返回结果 |
| `session-meta` | 否 | 会话元信息，如 `codebuddy.ai/hostKind` |
| `file-history-snapshot` | 否 | 文件历史快照 |
| `ai-title` | 否 | 自动生成的会话标题 |

只有 `message` 与 `function_call` 携带 `usage`；子代理文件遵循同一规则。各类型记录数见文末实测快照。

### 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 事件 ID（UUID v7 风格，非请求 ID） |
| `parentId` | string | 上一条事件 ID，构成链 |
| `timestamp` | number | 毫秒时间戳（本地时区无关，UTC 毫秒） |
| `type` | string | 事件类型，见上 |
| `sessionId` | string | 会话 ID；子代理文件中为**子会话 ID**，不在 `sessions` 表内 |
| `cwd` | string | 工作目录（部分记录携带） |
| `providerData.conversationRequestId` | string | **请求 ID**，跨文件唯一，是积分关联键 |
| `providerData.messageId` | string | 消息 ID |
| `providerData.stepSeq` | number | 请求内步骤序号（部分旧记录缺失） |
| `providerData.model` | string | 模型标识，如 `deepseek-v4.1-flash` |
| `providerData.requestModelId` | string | 请求使用的模型 ID |
| `providerData.requestModelName` | string | 模型展示名，如 `DeepSeek-V4.1-Flash`；**同一 `model` 标识可能有多种写法**，解析层需规范化 |
| `providerData.traceId` | string | 链路追踪 ID |
| `providerData.agent` | string | 调用方，如 `cli` |
| `message.usage.input_tokens` | number | 输入 token（**累计值**） |
| `message.usage.output_tokens` | number | 输出 token（**累计值**） |
| `message.usage.cache_read_input_tokens` | number | 缓存命中读取 token（**累计值**） |
| `message.usage.total_tokens` | number | 合计 token（**累计值**） |
| `_meta.traceparent` | string | OpenTelemetry 链路信息 |
| `_meta.baggage` | string | 形如 `codebuddy.session_id=...,codebuddy.conversation_request_id=...`，可作为 ID 的兜底来源 |

### 累计用量特性

同一 `conversationRequestId` 会对应多条带 `usage` 的记录，数值**通常单调递增**，表示"截至该步的累计消耗"，而不是本步增量：

```text
请求 01a10cb0c5c67ef994a18ace4f842e76
  function_call  34,728 → 41,205 → 48,357 → 54,745 → 63,667 → 69,521 → 74,973
  message        77,835   ← 最大值那条，该请求真实总量
```

但单调性不是保证：实测有少数请求出现数值回退，其中一个 231 步请求按时间排序的**最后一条**为 91,095，而 `total_tokens` 最大值为 270,284。因此口径一律取 `total_tokens` **最大那条**（四个 token 字段同源），不按时间戳取末条；文档其他地方出现的"末步"与"最大值"指同一条记录，不得理解为时间末条。

实测逐条累加约为按请求取最大值后的 **22 倍**，因此绝不求和。

## 关联键

| 键 | 来源 | 用途 | 可靠性 |
| --- | --- | --- | --- |
| `conversationRequestId` | jsonl `providerData` / `credit_json` 的键 | 请求识别、token 与积分对接 | 已验证：两侧完全一致，无孤键、无重复键 |
| `sessionId` | jsonl 字段 / 文件名 / `sessions.id` | 会话归属 | 主会话一致；子代理为子会话 ID，需取父目录名 |
| `cwd` | `sessions.cwd` | 分组维度 | 唯一可靠来源；部分空会话该字段为空串 |

**分组维度按工作目录划分，取值是 `sessions.cwd`**（旧称"项目"，与 WorkBuddy 桌面端新版的"分组"命名一致）。`sessions` 表里另有 `group_id` / `group_title` 与 `project_id` 列，它们是 WorkBuddy 自己的其它字段，**不是**本项目的分组维度来源，本项目不读取。

## 本地库 `workbuddy.db`

SQLite，由 WorkBuddy 管理。库内还有 `automations`、`automation_runs`、`workspaces` 等表，本项目只读取下列三张。

### `sessions`（40 列）

**标识与时间**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 会话 ID |
| `cwd` | TEXT NOT NULL | 工作目录，分组维度取值；不使用 `group_id` |
| `user_id` | TEXT NOT NULL | 用户标识 |
| `status` | TEXT NOT NULL DEFAULT `Pending` | 会话状态 |
| `created_at` | INTEGER NOT NULL | 创建时间（毫秒） |
| `updated_at` | INTEGER NOT NULL | 更新时间（毫秒） |
| `last_activity_at` | INTEGER | 最后活动时间（毫秒） |
| `deleted_at` | INTEGER | 非空表示已删除；本项目不参与过滤 |
| `is_playground` | INTEGER NOT NULL DEFAULT 0 | 是否演练场会话 |

**展示**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `title` | TEXT | 自动生成标题 |
| `custom_title` | TEXT | 用户自定义标题，优先展示 |
| `visibility` | TEXT | 可见性 |
| `unread` | INTEGER NOT NULL DEFAULT 0 | 未读标记 |
| `group_id` | TEXT | 分组 ID（本项目不读取） |
| `group_title` | TEXT | 分组标题（本项目不读取） |

**模型与专家**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `model` | TEXT | 会话模型，可为 NULL |
| `mode` | TEXT | 会话模式 |
| `expert_id` | TEXT | 专家 ID |
| `expert_locale` | TEXT | 专家语言区域 |
| `expert_runtime_identity` | TEXT | 专家运行时身份 |
| `expert_marketplace` | TEXT | 专家来源市场 |
| `last_user_prompt_expert_selection` | TEXT | 最近一次专家选择 |
| `thought_level` | TEXT | 思考等级 |
| `context_window` | INTEGER | 上下文窗口大小 |

**运行配置**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `source_mode` | TEXT | 会话来源模式 |
| `is_background_automation` | INTEGER | 是否后台自动化触发 |
| `permission_mode` | TEXT | 权限模式 |
| `use_sandbox_cli` | INTEGER | 是否使用沙箱 CLI |
| `project_id` | TEXT | 项目 ID（本项目不读取） |
| `plugin_context_json` | TEXT | 插件上下文 |
| `addon_selection` | TEXT | 附加能力选择 |
| `session_settings` | TEXT | 会话设置 |
| `buddy_snapshot_id` | TEXT | 快照 ID |
| `buddy_binding_json` | TEXT | 快照绑定信息 |
| `transport` | TEXT NOT NULL DEFAULT `local` | 传输方式 |
| `conversation_origin` | TEXT | 会话来源 |

**同步状态**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `agent_dirty` | INTEGER | 待同步标记 |
| `agent_dirty_at` | INTEGER | 标记时间 |
| `agent_last_synced` | INTEGER | 最后同步时间 |
| `verified_at` | INTEGER | 云端校验时间 |

索引：`idx_sessions_cloud_verified`、`idx_sessions_cloud_project`、`idx_sessions_cloud_group`、`idx_sessions_cloud_sort`、`idx_sessions_buddy_snapshot_id`，主键自动索引。

### `session_usage`（5 列）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | TEXT PK | 关联 `sessions.id` |
| `used` | INTEGER NOT NULL | 已占用上下文 token（本项目不使用） |
| `size` | INTEGER NOT NULL | 上下文窗口上限（本项目不使用） |
| `updated_at` | INTEGER NOT NULL | 更新时间（毫秒） |
| `credit_json` | TEXT | JSON 对象 `{conversationRequestId: 积分}`，可为 NULL 或 `{}` |

积分覆盖率不足 100%：部分请求没有积分记录，子代理请求全部没有；具体数量见文末实测快照。因此统计必须区分"积分值为 0"与"没有积分记录"两种情况。

### `workspaces`（2 列）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `path` | TEXT PK | 工作区路径 |
| `last_opened_at` | INTEGER NOT NULL | 最后打开时间（毫秒） |

## 数据可得性（已实测）

- `sessions.deleted_at` 非空是软删除标记，`sessions` 行仍在；但 WorkBuddy 清理会话时会移除对应的 `session_usage` 行，部分会话的 jsonl 也已不存在。实测已删除会话中只有少数仍有 jsonl，**全部没有 `session_usage` 行**：这类会话通常只剩 jsonl 中的 token，拿不到积分。
- 子代理请求的 token 可读，但 `credit_json` 中没有任何对应键，父会话也没有未匹配的孤键，即本地不存在子代理积分的记账。
- `conversationRequestId` 只对齐 jsonl 的 token 与 `credit_json` 的积分；分组、对话名、删除态由 `sessionId` → `sessions` 提供，不是同一个键。
- 所有 credit 键都能对应到现存请求，无孤键、无跨会话重复；带 `usage` 的记录当前无时间戳缺失。
- `sessions.deleted_at` 在本项目不参与过滤，也不提供排除开关：只要 jsonl 仍在，已删除会话的 token 就计入。
- 因此本项目只统计本地此刻能读到的数据，对已不可读的记录不追溯、不补齐。

## 访问方式

- 库为 WAL 模式，以 **只读模式** 打开（`new DatabaseSync(path, { readOnly: true })`），不加写锁，避免与运行中的 WorkBuddy 争抢。WAL 只读连接依赖同目录已存在的 `-wal` / `-shm`（WorkBuddy 运行时存在）；本机实测写入被拒，且 `workbuddy.db`、`-wal`、`-shm` 三个文件的大小与 mtime 在只读查询前后均未变化。
- 文件按行读取，遇不完整行（写入中）跳过，下次刷新补齐。
- 不监听文件变化，只在启动或手动刷新时扫描，减少与 WorkBuddy 的 IO 竞争。

## 兼容性风险

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| `usage` 语义变化 | 由累计改为增量 | 解析层集中字段映射，变更时只改一处；用「时间末条是否仍为最大值」做自检 |
| 累计值非单调 | 个别步骤数值回退，时间末条小于最大值 | 取 `total_tokens` 最大那条的同源四项，不做差值推算；记录告警 |
| 新增事件类型 | 未知 `type` 出现 | 忽略未知类型，不中断解析 |
| 字段名变化 | 同一含义出现新键名（如 `inputTokens`、`prompt_tokens`） | 当前只认实测字段；新增别名时只在解析层的字段映射处加一项 |
| 子代理目录结构变化 | 路径不再是 `subagents/agent-*.jsonl` | 扫描改为递归查找 `*.jsonl`，以路径特征判断归属 |
| `credit_json` 结构变化 | 值由数字变为对象 | 解析时判型，非数字按无积分处理并记录告警 |
| 会话被清理 | jsonl 或 db 行消失 | 索引按文件存在性与 `source_file` 对账，删除对应请求；积分随 `session_usage` 行消失，按无积分处理且不补齐 |

字段命名分两层：**内部字段**（TypeScript 类型、索引列名、API 返回）由本项目命名，可自由调整；**外部键名**（jsonl 与 `workbuddy.db` 的字段）由 WorkBuddy 决定，只能适配。当前实测字段固定为 `message.usage` 下的 `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `total_tokens`，以及 `providerData` 下的 `conversationRequestId` / `model` / `requestModelName`；本项目只统计本机 WorkBuddy 单一来源，v1 不引入参考项目那套多来源别名表，字段映射集中在解析层。

## 实测快照

2026-11-11 21:15（WorkBuddy 运行中，数值会持续增长；仅作量级校验，不作断言）：

- 文件：109 个 `*.jsonl`（101 主会话 + 8 子代理），合计约 125MB；`projects` 目录整体约 161MB，另含 96 个 `.ndjson` 与 1388 个 `.txt`，均不参与解析。
- 记录：带 `usage` 的记录 7157 条（主会话 6917、子代理 240）。
- 请求：393 个（主会话 385、子代理 8）；主/子请求 ID 无重叠，跨文件重复的请求 ID 为 0，每个子代理文件恰好 1 个请求。
- token：按请求取最大值合计约 5750 万；逐条累加约 12.7 亿（约 22 倍）。
- 积分：224 条记录，合计 1673.61；169 个请求无积分记录（含全部 8 个子代理请求）；无孤键、无重复键、无非数字值。
- 会话：117 条（20 条已删除、16 条 `cwd` 为空、16 条 `model` 为空）；`session_usage` 95 行。
- 多步骤请求：359 / 393（约 91%）；6 个请求出现累计值回退，其中 1 个请求的时间末条小于最大值。
- 维度规模（22:59 复测，405 个请求）：9 个模型标识、65 个分组、98 个有请求的会话；`deepseek-v4.1-flash` 等标识对应 2–3 种不同的 `requestModelName` 写法。
- 恒等校验：`total = input + output` 与 `cache_read ≤ input` 均零例外；当前记录的 `timestamp` 与 `providerData.model` 无缺失。
