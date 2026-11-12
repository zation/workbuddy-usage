# 子代理积分对账

## 状态

2026-11-13 已结案，不立交付。长期结论见 [integration.md](../integration.md) 的「积分数据形态」「与官方账单的对比」，架构决策见 [technical-architecture.md](../technical-architecture.md) 的系统边界。

## 背景

本地 `session_usage.credit_json` 的键只对得上主会话请求，子代理请求没有独立键；覆盖率把子代理计入分母，界面标注「子代理无本地积分记录」。

## 调研结论

1. `credit_json` 是请求内所有消息步 `rawUsage.credit`（逐条增量）之和，并并入团队子代理与生成工具的 cost；不是取最大值或末条。
2. 团队子代理积分经 `credit-usage`（`source=team_member`）并入父请求；普通 Task 子代理两边都是 0；`custom_agent` 接口有计费、本地 0，是真实缺口（31 天 4 条 / 10.20 分）。
3. 本地与官方账单：31 天覆盖 64.4%、近 8 天 96.2%，**本地有、接口无 0 行**；缺口主要是本地从未落地的历史与 `app_cloud` 通道，不是“删对话”造成的。
4. `has_credit` 只表示本地账本有无键，无法区分免费模型、子代理与真缺失；覆盖率的分子分母都不可靠。

## 决策

- **不接入官方计量接口**：只有 `requestId` / `credit` / `model` / `client` / `requestTime`，没有 `sessionId` / `groupId`；31 天内 58% 的行无法归属，四维筛选不成立，OAuth + 加密存储的维护成本与收益不匹配。
- **移除覆盖率指标**（已完成 2026-11-13）：`/api/summary` 的 `coverage` / `creditedRequestCount` / `uncreditedRequestCount` 与「覆盖率」「无积分记录」两张卡片已删除；请求行不再返回 `hasCredit`，界面统一显示积分值。`requests.has_credit` 列保留，仅用于对账与排查。

## 保留资产

- 一次性脚本（仓库外）：`credit-reconcile.mjs`（JSON 对账）、`credit-api-scan.mjs`（cookie 扫 31 天）。
- 接口字段、鉴权两条路、28/30 天有效期见 [integration.md](../integration.md)。

## 重估条件

官方接口补充会话 / 分组字段，或需求退化为「只要总额 / 历史」的独立对账页。
