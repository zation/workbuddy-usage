# 外部数据源集成

本项目的数据全部来自 WorkBuddy 的本地运行数据，**只读、不写、不备份**。本文件记录这些外部数据的实际格式，供解析层实现与后续兼容性判断使用。

## 数据源清单

| 来源 | 路径 | 内容 | 访问方式 |
| --- | --- | --- | --- |
| 会话事件流 | `~/.workbuddy/projects/<编码cwd>/<sessionId>.jsonl` | 消息、工具调用、token 用量 | 逐行读取 |
| 子代理事件流 | `~/.workbuddy/projects/<编码cwd>/<sessionId>/subagents/agent-<uuid>.jsonl` | 子代理的独立对话与用量 | 逐行读取 |
| WorkBuddy 数据库 | `~/.workbuddy/workbuddy.db` | 会话元信息、积分、工作区 | SQLite 只读连接 |

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

实测逐条累加约为按请求取最大值后的 **40 倍**（随单请求步骤数变化，不是固定倍数），因此绝不求和。

## 关联键

| 键 | 来源 | 用途 | 可靠性 |
| --- | --- | --- | --- |
| `conversationRequestId` | jsonl `providerData` / `credit_json` 的键 | 请求识别、token 与积分对接 | 已验证：两侧同一命名空间、无重复键；会话清理后会留下少量孤键，挂接时忽略 |
| `sessionId` | jsonl 字段 / 文件名 / `sessions.id` | 会话归属；本项目 `sessions` 维表的 `session_key` 就是这个值 | 主会话一致；子代理为子会话 ID，需取父目录名 |
| `cwd` | `sessions.cwd` | 分组维度 | 唯一可靠来源；部分空会话该字段为空串 |

**分组维度按工作目录划分，取值是 `sessions.cwd`**（旧称"项目"，与 WorkBuddy 桌面端新版的"分组"命名一致）。`sessions` 表里另有 `group_id` / `group_title` 与 `project_id` 列，它们是 WorkBuddy 自己的其它字段，**不是**本项目的分组维度来源，本项目不读取。

2026-11-13 实测（只读查询）：`sessions` 表 148 行，`group_id` / `group_title` / `project_id` 的非空行数**均为 0**，即三者全部为 NULL——没有可用的分组类型字段，只能按路径形态判定。同一快照里 16 行 `cwd` 为空（归入「未知分组」），81 行 `cwd` 是 `<...>/WorkBuddy/yyyy-MM-dd-HH-mm-ss` 形态（归入「默认」）。

判据只看路径末两段：末段匹配 `yyyy-MM-dd-HH-mm-ss`、父段忽略大小写等于 `WorkBuddy` 即视为自动目录，`/` 与 `\` 都接受，不校验日期是否合法。末段形似日期但父目录不是 `WorkBuddy` 的路径、以及 `WorkBuddy` 下的非日期目录，都按手动分组处理。该判定只在解析层写入数据库时执行一次，结果存 `groups.is_auto`；WorkBuddy 若改变自动目录的命名格式，判定会失效，需要更新规则并递增 `schema_version` 重建数据库（见兼容性风险）。

## WorkBuddy 数据库 `workbuddy.db`

SQLite，由 WorkBuddy 管理。该数据库内还有 `automations`、`automation_runs`、`workspaces` 等表，本项目只读取下列三张。

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

`credit_json` 的值是**该请求所有消息步的积分之和**（客户端按 `usage_update.cost` 累加，见「积分数据形态」），不是取最大值、也不是末条。子代理请求不会单独成键：普通子代理本来不计费，团队子代理的积分并入父请求，详见下一节。

`credit_json` 不是每个请求都有键：免费模型与部分辅助调用在本地不记账。因此统计必须区分"积分值为 0"与"没有积分记录"两种情况，但不再用覆盖率一类指标呈现（分子分母都无法从本地可靠定义，决策见 [backlog](./backlog/subagent-credit-reconciliation.md)）。

### `workspaces`（2 列）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `path` | TEXT PK | 工作区路径 |
| `last_opened_at` | INTEGER NOT NULL | 最后打开时间（毫秒） |

## 积分数据形态（实测）

积分在本地有三套记录，粒度不同，不能互相替代。

### 逐条积分（jsonl）

`providerData.rawUsage.credit` 是模型响应携带的积分值，**按消息步增量计**（同一请求内各步数值独立，求和才是请求总额）；`message.usage` 只有四个 token 字段，不含 `credit`。少数旧记录的 `providerData.usage.credit` 语义相同，可作为别名兜底。

同一对象里还有 `original_credit`：实测 534 条、**全部 `credit = 0`**，合计 1552.26，是免费模型（`hy4-free` / `hy3` 等）按原价折算的名义值，不是实付积分——统计只能用 `credit`，不能用它。

### 独立积分事件（`credit-usage`）

`type=credit-usage` 是唯一的“单独一条积分记录”，普通请求没有。实测 166 条、`source` 全部是 `team_member`，字段固定为：

```
id, parentId, timestamp, type, cwd, _meta,
providerData: { conversationRequestId, credit, source, stageId, messageId }
```

它由客户端在团队子代理回传积分时写入父会话，同时以父 `conversationRequestId` 上报 cost，最终并入父请求的 `credit_json`。

### 请求级积分（`credit_json`）

客户端不把响应里的 `credit` 直接落库，而是通过 ACP `usage_update` 的 `cost.amount` 上报，桌面端按 `_meta["codebuddy.ai/requestId"]` **累加**后写入 `credit_json`（`app.asar` 的 `wireBackend`：`credit[requestId] = (credit[requestId] ?? 0) + cost.amount`）。由此可得：

- 一条请求的 `credit_json` 值 = 该请求全部消息步之和，再加上并入的 `team_member` / `generation_tool` 等来源的 cost。
- 累加是浮点相加，值可能带尾差（如 `202.38999999999996`）。
- 刷新时整份重读，口径与 jsonl 的 token 最大值取值无关。

### 子代理积分

- 普通子代理（Task 等）的 `rawUsage.credit` 实测为 `0`：现存 240 条子代理记录中 97 条为 0（Task 类），143 条为正且全部来自同一次团队运行。Task 子代理两边都不计费，本地看不到独立金额。
- 团队成员的子代理积分大于 0，客户端经 `_fromSubAgent` 输入项转成 `credit-usage`（`source=team_member`）历史事件写入**父会话 jsonl**，同时以父请求 ID 上报 cost。实测一次团队请求：143 条 `credit-usage` 合计 108.84，父请求 `credit_json` 为 202.39 = 主会话 16 步 93.55 + 108.84。
- 所以子代理积分在本地是**存在**的，只是记在父请求名下；子代理自己的 `conversationRequestId` 实测未成为 `credit_json` 的键。

### 对账实测（2026-11-12）

- 423 个请求在 jsonl 里带 `credit` 字段，其中 243 个合计为正；`credit_json` 当前 238 个键。
- 逐请求对比（jsonl 按 `messageId` 去重后求和 vs `credit_json`）：215 个完全一致（±0.01）、23 个本地偏高、**0 个本地偏低**。两个最大的偏高值正好等于并入父请求的子代理积分（108.84、25.36），其余为 0.1–1 量级。
- 按会话汇总（主文件 + 子代理文件合计）对比：68 个可比会话中 55 个一致，13 个本地偏高（最大 25.36），无偏低。
- 结论：本地 jsonl 与 `credit_json` 之间**不存在系统性偏低**；差异方向是本地略高（约 1–2%），不是缺失。但这是本地两套数据之间的对账，看不到服务端计费——与官方接口对照后结论有补充，见下节。

### 不进入本地 `requests` 的辅助调用

官方账单里还有几类独立 `requestId`，但本地 jsonl 不产生请求行：

| `agentPurpose` | 31 天实测 | 本地是否有请求行 |
| --- | --- | --- |
| `webfetch`（网页内容分析） | 22 条 / 10.79 | **0 条**，完全不落 |
| `conversation_topic`（生成会话标题） | 146 条 / 0.12 | 0 条 |
| `context_summary_*` / `prompt_suggestion` | 3 条 / 3.10 | 0 条 |
| `conversation:compact` | 20 条 / 155.76 | 12 条（桌面端触发，积分与接口完全一致）；8 条为云端或已清理 |

这些调用在本地没有请求行，因此本地积分总额天然低于官方账单，不能按“缺失”处理。

### 官方计量接口（未接入）

第三方项目 `workbuddy-switch` 使用 `POST https://www.workbuddy.cn/billing/meter/get-user-request-usage`，body 为 `{startTime, endTime, pageNum: 1, pageSize: 3000}`，响应 `data.data[]` 每条含 `requestId` / `credit` / `model` / `client` / `requestTime`，另有 `agentPurpose`、`appType`、`subscribeType`，以及 `input` / `inputTrunc`（prompt 原文，含本机路径，**不得落库**）。

- WorkBuddy 客户端本身**不调用**该接口：`app.asar` 内只有 `get-user-resource-summary`（余额）与 `get-enterprise-user-usage`，没有逐请求明细接口；客户端拿到的逐条明细只有流式响应里的 `rawUsage.credit`。
- 与本地的差异：粒度（每请求一行 vs 本地按消息步累加）、归属（是否单列子代理请求）、覆盖（31 天窗口 vs 仅现存 `session_usage` 行）、取值（服务端账单 vs 客户端累加）。
- **不含 token**：单条记录只有 `requestId` / `credit` / `model` / `client` / `requestTime` / `input` / `inputTrunc` / `agentPurpose` / `appType` / `subscribeType`，没有任何 token 字段；网页用量页也只展示 credit。token 只存在于模型响应的 `usage`（本地 jsonl）与 CodeBuddy IDE 的 `CodeBuddyExtension/Data/**/history/**/index.json` 的 `requests[].usage` 中。
- **鉴权**：网页端用 `session` cookie（约 7 天，值内含过期时间戳）；插件 / CLI 用 `Authorization: Bearer`，OAuth 设备码流程为 `POST /v2/plugin/auth/state` → 浏览器登录 → 轮询 `GET /v2/plugin/auth/token?state=`，刷新走 `POST /v2/plugin/auth/token/refresh`（`X-Refresh-Token` + `X-Auth-Refresh-Source: plugin`）。实测 access token 28 天、refresh token 30 天。
- **本地登录态**：`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`，`auth.accessToken` / `refreshToken` 是 `{$wbEncrypted, envelope}` 加密信封，`expiresAt` / `refreshExpiresAt` 明文可读；第三方无法解密，参考项目也只在账号切换时原样透传。
- 接入需要鉴权与联网，属于系统边界变更；2026-11-13 评估后决定不接入，原因见系统边界。

### 与官方账单的对比（2026-11-12）

用网页 `session` cookie 实调 31 天窗口（`pageSize=3000`，一次取回 749 行）：

| 区间 | 接口 | 本地 | 本地 / 接口 | 接口独有 |
| --- | --- | --- | --- | --- |
| 10-14 – 11-04 | 439 行 / 1904.69 | 199 行 / 830.72 | 43.6% | 338 行 / 1188.00 |
| 11-05 – 11-12 | 310 行 / 1246.70 | 212 行 / 1199.16 | 96.2% | 98 行 / 46.86 |
| 合计 | 749 行 / 3151.39 | 411 行 / 2029.88 | 64.4% | 436 行 / 1234.86 |

- 近 8 天接口 = `WorkBuddy` 1207.46 + `app_cloud` 39.24；本地缺的 46.86 里 `app_cloud` 占 39.24，其余是 webfetch / compact / 标题等辅助请求。**本地有、接口无：0 行**，接口是超集。
- 更早半个月本地只剩 43.6%：本地留存的同期请求几乎都是免费模型，付费请求无 `sessions` 行也无 jsonl，属“从来没落过地”；`transport='cloud'` 的 16 个会话本地 0 条请求。
- 删除会话确实会同时清掉 jsonl 与 `session_usage`，但 `deleted_at > 0` 只有 24 个（20 个当天创建当天删除），被删会话在本地仅残留 3 条请求，量级不足以解释缺口。
- 未发现统一的按天保留期（9 月底的文件仍在），所以不像“到点自动清理”。

### 官方接口抽样对照（2026-11-12）

`POST /billing/meter/get-user-request-usage` 返回的 `requestId` 与本地 `conversationRequestId` **同一命名空间**：抽样 15 个 ULID 请求，13 个与本地 `credit` 分毫不差，2 个差 −0.65 / +0.31；1 个进行中的请求本地偏高（接口快照早于请求结束）。

但接口会把 **`custom_agent` 这类独立子代理**按独立 `requestId` 单列并计费，而本地该请求的 `credit` 为 0：

| requestId | 本地 | 接口 | 说明 |
| --- | --- | --- | --- |
| `e012efdd…`（agentPurpose `custom_agent:sheet-agent`） | 0 | 4.15 | 本地存在该请求、`is_subagent=1`，但无积分 |
| `0dec73fe…`（同类） | 无记录 | 2.73 | 接口有、本项目数据库未收录 |
| `01a1caf9…` | 15.49 | 15.49 | 主请求，逐条 jsonl 只加到 3.36，说明本地累加值才是账单值 |

结论修正：**主请求本地与账单一致**；Task 子代理（`hy4-free`）两边都是 0，不构成缺口；`custom_agent` 这类独立子代理接口有计费、本地 0，是真实缺口（31 天实测 4 条 / 10.20 分）。团队子代理的积分则并入父请求，见上。

补充（同日 23:18 用页面导出核对）：导出 300 行里，「请求」列以「子Agent…」开头的 5 条均为 `hy4-free`、积分 0，与本地一致；以「文件路径：」开头的 2 条 custom_agent 请求分别 2.73 / 4.15，本地均为 0——即**计费缺口集中在 custom_agent 这类独立子代理**。8 天窗口本地合计 1142.60、导出 WorkBuddy 通道 1146.31，净差 −3.71（−0.32%），缺口被本地少量高估抵消，总额量级可用。

## 数据可得性（已实测）

- `sessions.deleted_at` 非空是软删除标记，`sessions` 行仍在；但 WorkBuddy 清理会话时会移除对应的 `session_usage` 行，部分会话的 jsonl 也已不存在。实测已删除会话中只有少数仍有 jsonl，**全部没有 `session_usage` 行**：这类会话通常只剩 jsonl 中的 token，拿不到积分。
- 子代理请求的 token 可读；`credit_json` 中没有任何以子代理 `conversationRequestId` 为键的记录。Task 子代理的响应积分为 0，团队子代理的积分并入父请求，因此**本地并非没有子代理积分，而是没有独立的键**（见「积分数据形态」）。
- `conversationRequestId` 只对齐 jsonl 的 token 与 `credit_json` 的积分；分组、对话名、删除态由 `sessionId` → `sessions` 提供，不是同一个键。
- 实测存在少量孤键（`session_usage` 仍有键、对应 jsonl 已删；当前 11 个），挂接时忽略；无跨会话重复键；带 `usage` 的记录当前无时间戳缺失。
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
| 自定义模型标识重名 | 自定义模型与原生模型使用同一 `model` 标识 | 当前原始日志无可区分字段，暂按同一模型合并；待 WorkBuddy 提供来源字段后再扩展维表 |
| 子代理目录结构变化 | 路径不再是 `subagents/agent-*.jsonl` | 扫描改为递归查找 `*.jsonl`，以路径特征判断归属 |
| `credit_json` 结构变化 | 值由数字变为对象 | 解析时判型，非数字按无积分处理并记录告警 |
| 会话被清理 | jsonl 或 db 行消失 | 数据库按文件存在性与 `source_files` 对账，删除对应请求；积分随 `session_usage` 行消失，按无积分处理且不补齐 |
| 自动目录命名格式变化 | 新的自动工作目录不再匹配 `.../WorkBuddy/yyyy-MM-dd-HH-mm-ss`，被判为手动分组，筛选下拉重新出现条目 | 更新解析层的形态规则并递增 `schema_version` 删库重建，不静默猜测，也不依赖增量刷新纠正存量行 |

字段命名分两层：**内部字段**（TypeScript 类型、索引列名、API 返回）由本项目命名，可自由调整；**外部键名**（jsonl 与 `workbuddy.db` 的字段）由 WorkBuddy 决定，只能适配。当前实测字段固定为 `message.usage` 下的 `input_tokens` / `output_tokens` / `cache_read_input_tokens` / `total_tokens`，以及 `providerData` 下的 `conversationRequestId` / `model` / `requestModelName`；本项目只统计本机 WorkBuddy 单一来源，v1 不引入参考项目那套多来源别名表，字段映射集中在解析层。

## 实测快照

2026-11-12 13:15（WorkBuddy 运行中，数值会持续增长；仅作量级校验，不作断言）：

- 文件：265 个 `*.jsonl`（218 主会话 + 47 子代理），合计约 444MB；`projects` 目录另含 212 个 `.ndjson` 与 3992 个 `.txt`，均不参与解析。
- 记录：带 `usage` 的记录 31,224 条（主会话 30,038、子代理 1,187）。
- 请求：903 个去重请求（主会话 860、子代理 43）；多步骤请求 842 个（约 93%）；累计值回退 47 个，其中 3 个的时间末条小于最大值。
- 跨文件重复：31 个 `request_id` 同时存在于两个会话文件，数值完全相同；按 R11 只计一次。
- token：按请求取最大值合计 169,950,303（主会话 165,776,607、子代理 4,176,182）；逐条累加 6,757,760,362，约 39.8 倍。
- 积分：477 条记录，合计 5,581.40；426 个请求无积分记录（含全部 43 个子代理请求——子代理没有独立键，团队子代理积分并入父请求）；无重复键、无非数字值，当时无孤键。
- 会话：251 条（39 条已删除、11 条 `cwd` 为空、11 条 `model` 为空）；`session_usage` 207 行；已删除会话均无 `session_usage` 行。
- 维度规模：11 个模型标识、58 个有请求的分组（分组维表 80 行）、203 个有请求的会话；`deepseek-v4.1-flash` 等标识对应 2–3 种不同的 `requestModelName` 写法。
- 恒等校验：`total = input + output` 与 `cache_read ≤ input` 均零例外；当前记录的 `timestamp` 与 `providerData.model` 无缺失。
