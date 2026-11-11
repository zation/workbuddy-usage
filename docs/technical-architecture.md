# 技术架构

<!-- 记述当前实现的系统结构与关键技术决策，不记录实现步骤和代码细节。 -->

## 系统边界

- **输入**：`~/.workbuddy/projects/**/*.jsonl`（会话事件流）与 `~/.workbuddy/workbuddy.db`（会话元信息与积分）。全部只读。
- **输出**：本地浏览器面板；项目内的派生索引 `.data/index.db`（可删除重建，不入库）。
- **不跨越的边界**：不向网络发送任何数据，不写 `~/.workbuddy` 下任何文件，不修改 WorkBuddy 配置。

## 模块划分

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| 解析层 | `src/etl/` | 扫描 jsonl 与外部库，按请求归并步骤、挂接积分与会话，产出请求级记录 |
| 索引层 | `.data/index.db` | 派生 sqlite，按文件 mtime/大小增量更新，可整体重建 |
| 服务层 | `server/` | 读索引做聚合查询，提供 HTTP API，生产模式下兼作静态资源服务器 |
| 面板层 | `src/web/` | React + ECharts，负责筛选、下钻与呈现，不承担统计口径 |

分层原则：**口径只存在于解析层与服务层**。面板层只渲染 API 返回值，不自行求和或换算，避免同一指标出现两套算法。

## 关键依赖

| 依赖 | 用途 | 说明 |
| --- | --- | --- |
| Node.js ≥ 24 | 运行时 | `node:sqlite` 在本机 24.19.0 实测可用，免 flag、免 native 编译 |
| TypeScript | 全仓类型 | 解析结果类型即 API 契约，贯穿到面板 props |
| Vite + React | 面板 | 开发期热更新 |
| ECharts | 图表 | 趋势线、占比、堆叠柱 |
| Hono | 服务层 | 端点会随下钻增加，路由与中间件比手写 http 清晰 |

不引入 ORM 与状态管理库：索引库只有单表，数据量为请求级（当前 380 条，量级可忽略）。

## 数据流

```
~/.workbuddy/projects/*/*.jsonl ─┐
                                 ├─→ 解析层（增量）─→ .data/index.db ─→ 服务层聚合 ─→ HTTP API ─→ React 面板
~/.workbuddy/workbuddy.db ───────┘                          ↑
   （只读：sessions / session_usage）                  启动时读取会话元信息（百余行，毫秒级）
```

刷新时机：`npm start` 启动时做一次增量解析；面板提供手动刷新入口触发同一流程。不做文件监听，避免与 WorkBuddy 运行时的频繁写入互相干扰。

## 接口

服务层对外只有一组只读端点，参数统一为 `from`、`to`（`YYYY-MM-DD`）与可选的 `project`、`model`、`session`：

| 端点 | 返回 |
| --- | --- |
| `GET /api/summary` | 区间合计：token 四项、积分、请求数、会话数 |
| `GET /api/timeseries?bucket=day\|week\|month` | 按时间桶的序列 |
| `GET /api/breakdown?dim=project\|model\|session` | 按单一维度分组的聚合与占比 |
| `GET /api/requests` | 请求级明细，用于表格与排序 |
| `POST /api/refresh` | 触发增量解析，返回新增/跳过文件数 |

所有返回值为聚合结果或请求级明细，不下发原始 jsonl 内容。

## 部署方式

- 开发：`npm run dev`，Vite 起面板，API 单独起并通过 Vite proxy 转发 `/api`。
- 使用：`npm run build && npm start`，由服务层同端口提供静态资源与 API，浏览器打开 `http://localhost:<PORT>`。
- 无容器、无反向代理、无进程守护需求，单机单进程即可。

## 技术约束

- **Node 版本**：PATH 首位是 WorkBuddy 托管的 22.22.2，其 `node:sqlite` 需 `--experimental-sqlite`；本机另有 24.19.0。项目以 `engines` 声明 `>=24` 并在入口校验版本，不依赖调用方 shell 的 PATH 顺序。
- **外部库只读**：以只读模式打开 `workbuddy.db`，避免与运行中的 WorkBuddy 争锁。
- **数据量**：当前 107 个 jsonl、158MB、380 个请求、6811 条带 usage 的记录。全量解析约 5–15 秒，因此增量更新是硬要求，不是优化项。
- **路径处理**：Windows 盘符与分隔符差异统一交给 `node:path`，不手拼字符串。
- **日志格式不稳定**：WorkBuddy 升级可能改字段，解析层需集中字段映射并保留兼容分支。

## 架构决策

**AD-1 全 TypeScript 单仓。** 面板是唯一交付物，类型从解析层一路贯到图表 props，改字段时编译器能兜住；代价是接受 node_modules 与构建步骤。Python 方案在解析上更省事，但把成本转移到了前端手写图表与跨语言契约上。

**AD-2 以请求（`conversationRequestId`）为核算单位。** 积分本身就是请求粒度，token 又在该粒度内累计，两者天然对齐；若按步骤统计，token 会重复计算约 20 倍以上。

**AD-3 派生索引用 sqlite 而非单个 JSON 文件。** 需要按 mtime 增量 upsert、按维度聚合、按时间排序，sqlite 一条 SQL 就能覆盖；`node:sqlite` 零依赖，避免了 `better-sqlite3` 在 Windows 上的编译问题。索引可删可重建，因此不承担数据安全责任。

**AD-4 聚合放在服务层。** 若把请求级明细全量下发到前端再聚合，数据增长后首屏会越来越慢；服务端返回小结果集，钻取时再按需取明细。

**AD-5 外部数据只读且不做备份。** 原始数据的所有权属于 WorkBuddy，本项目不复制、不归档，只派生。这样无论 WorkBuddy 如何清理旧日志，本项目都不会产生"过期副本"这类需要维护的东西。

**AD-6 日期归属取请求内最早步骤的本地时间。** 跨零点的长请求归入发起当天，符合"这天花了多少"的直觉；用本地时区而非 UTC，避免出现"晚上八点算到明天"的错位。
