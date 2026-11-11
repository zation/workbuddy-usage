# 数据模型

<!-- 无持久化数据时保留本文件，并在下方说明“不适用”及原因。 -->

本项目不产生业务数据，只读 WorkBuddy 本地已有数据，并按统计需要建立一份派生索引。因此数据模型分两层：**外部只读源**（不可改，随 WorkBuddy 版本变化）与**本地派生索引**（可随时删除重建）。

## 核心实体

| 实体 | 来源 | 粒度 | 说明 |
| --- | --- | --- | --- |
| Project（项目） | `sessions.cwd` | 工作目录 | 统计维度之一，取值即会话所在目录的绝对路径 |
| Session（会话） | `sessions` 表 + jsonl 文件 | 一次连续对话 | 统计维度"对话" |
| Request（请求） | jsonl 中按 `conversationRequestId` 聚合 | 一次用户输入 | token 与积分的最小核算单位 |
| Step（步骤） | jsonl 中单条带 `usage` 的记录 | 请求内一次模型调用 | 其 `usage` 为累计值，仅用于求请求总量 |
| CreditEntry（积分记录） | `session_usage.credit_json` | 一个请求一条 | 键为 `conversationRequestId`，值为积分 |
| ModelInfo（模型） | `providerData.model` | 请求级 | 统计维度之一 |

## 字段

### 会话文件 `~/.workbuddy/projects/<编码后的 cwd>/<sessionId>.jsonl`

每行一个 JSON 事件，与本项目相关的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 事件类型，见下方枚举 |
| `timestamp` | int | 毫秒时间戳 |
| `sessionId` | string | 会话 ID，与文件名和 `sessions.id` 一致 |
| `providerData.conversationRequestId` | string | 请求 ID，跨文件唯一，关联积分 |
| `providerData.model` | string | 模型标识，如 `deepseek-v4.1-flash` |
| `providerData.requestModelName` | string | 模型展示名，如 `DeepSeek-V4.1-Flash` |
| `providerData.stepSeq` | int | 请求内步骤序号 |
| `providerData.messageId` | string | 消息 ID |
| `message.usage.input_tokens` | int | 输入 token（累计） |
| `message.usage.output_tokens` | int | 输出 token（累计） |
| `message.usage.cache_read_input_tokens` | int | 缓存命中读取 token（累计） |
| `message.usage.total_tokens` | int | 合计 token（累计） |

`type` 枚举：`session-meta`、`message`、`reasoning`、`function_call`、`function_call_result`、`file-history-snapshot`、`ai-title`。其中只有 `function_call` 与 `message` 携带 `usage`。

### `workbuddy.db`（SQLite，只读）

`sessions` 表与本项目相关的列：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT | 会话 ID，主键 |
| `cwd` | TEXT | 会话所属目录，即"项目"维度的取值 |
| `title` / `custom_title` | TEXT | 自动标题 / 用户改名，用于对话列表展示 |
| `model` | TEXT | 会话模型，可为 NULL |
| `created_at` / `updated_at` / `last_activity_at` | INTEGER | 毫秒时间戳 |
| `deleted_at` | INTEGER | 非空表示会话已删除 |
| `is_playground` | INTEGER | 是否演练场会话 |

`session_usage` 表：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | TEXT | 关联 `sessions.id` |
| `used` | INTEGER | 已占用上下文 token |
| `size` | INTEGER | 上下文窗口上限 |
| `updated_at` | INTEGER | 毫秒时间戳 |
| `credit_json` | TEXT | JSON 对象，`{conversationRequestId: 积分浮点数}`，可为 NULL 或 `{}` |

`workspaces` 表：`path`、`last_opened_at`，用于项目最近打开时间。

## 关系

```
Project 1 ──< Session 1 ──< Request 1 ──1 CreditEntry
                               │
                               └──< Step  （usage 累计，取末步）
```

- `Request.sessionId` ← jsonl 文件名 / `sessionId` 字段，连接 `sessions.id`。
- `Request.credit` ← `session_usage.credit_json[conversationRequestId]`。**已验证**：积分键与 jsonl 中的 `conversationRequestId` 完全对应，是无损一对一关联。
- `Project` ← `sessions.cwd`。jsonl 目录名是 cwd 的编码形式（盘符小写、非字母数字替换为 `-`，如 `e-Project-workbuddy-usage`），属有损编码，**不以目录名还原路径**，一律以 `sessions.cwd` 为准。

## 约束

- **用量必须按请求去重**：同一 `conversationRequestId` 下有多条带 `usage` 的记录（步骤），其数值单调递增。请求总量取该请求内 `total_tokens` 最大的一条（等价于末步）。逐条累加会把 token 虚高约 20 倍以上，实测 6811 条累加得 12.35 亿，按请求取末值为 5534 万。
- **积分按请求取值**：`credit_json` 一个请求一个数值，不做跨请求求和以外的加工。
- **已删除会话**：`sessions.deleted_at` 非空的会话仍在库与磁盘上，默认计入历史消耗（消耗已经发生），但需在界面上可区分并支持过滤。当前 115 条会话中 20 条已删除。
- **模型缺失**：部分会话 `sessions.model` 为 NULL（当前 16 条）。模型维度优先取请求级 `providerData.model`，取不到时归入"未知模型"，不丢弃该请求的用量。
- **无用量记录**：16 条会话没有对应 jsonl 文件，视为空会话，不产生统计行。
- **只读**：对 `~/.workbuddy/` 下任何文件只做读取，不做写入、移动或删除。

## 生命周期

1. **采集**：扫描 `~/.workbuddy/projects/*/*.jsonl` 与 `workbuddy.db`，按文件 mtime 与大小判断是否需要重新解析。
2. **解析**：逐行读取 jsonl，按 `conversationRequestId` 归并步骤，得到请求级记录；同一请求可能在多个文件中出现（续写），以总量最大者为准。
3. **关联**：用 `conversationRequestId` 挂积分，用 `sessionId` 挂会话与项目。
4. **派生**：按日期（请求最早步骤的时间戳，取其本地日期）、项目、会话、模型四个维度预聚合。
5. **失效**：派生索引可随时删除重建；WorkBuddy 清理旧日志时，索引中对应当前数据自然消失。

## 数据库结构与迁移

- 外部库 `workbuddy.db` 由 WorkBuddy 管理，本项目**只读打开**，不建表、不写、不加锁（以只读 URI 打开，避免与运行中的 WorkBuddy 争锁）。
- 本地派生索引由本项目自建（位置在项目内 `.data/`，不入库），仅作为缓存；删除后可从原始数据完整重建，因此不需要迁移脚本。
- 若日后 WorkBuddy 变更 `usage` 字段或 `credit_json` 结构，需同步更新解析层与本文档，并保留旧格式的兼容分支。
