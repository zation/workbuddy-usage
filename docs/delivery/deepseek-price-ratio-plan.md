# DeepSeek 官方价格对比与时间口径统一 Plan

本计划对应 [deepseek-price-ratio-spec.md](./deepseek-price-ratio-spec.md)（Spec 已由 `627a181` 固化）。沿用 AGENTS.md 的标准流程，本文件经确认并单独提交后才进入 Tasks 与实现。

## 现状分析

**数据链路**：ETL（`src/etl/` 解析 jsonl + 只读 `workbuddy.db`）→ SQLite 数据库 `.data/index.db` → Hono 服务层（`server/query.ts`）→ React + ECharts 面板（`/api/*` + `src/web/`）。口径只在解析层与服务层，前端只渲染 API 返回值。

**可直接复用的部分**：`requests` 表已有 `input_tokens / output_tokens / cache_read_tokens` 三列，请求级同源（C2），且 `TimeseriesRow`、`SummaryResponse`、`getTimeseries` 的 SQL 已把三列贯通到 API；`buildWhere(filters)` 让四个筛选条件在所有端点复用；`model-colors.ts` 提供了「按模型业务键的显式静态参数表 + 规则文档 + 一致性单测」的现成范式；`SCHEMA_VERSION` 不匹配即删库重建，加列无迁移成本。实测规模 483 请求 / 11 模型 / DS 254 请求，按天二次聚合的代价可忽略。

**时间处理 review 结论**：所有时间字段本就是 UTC 毫秒时间戳（绝对时间），问题只在折算处——`src/shared/dates.ts` 的 `toDateKey` / `formatDateKey` / `parseDateKey` / `addDays`、`src/web/filters.ts` 的 `todayKey`、`src/web/format.ts` 的两个格式化函数、`scripts/panel-acceptance.mjs` 的 `today`，多处折算读机器时区；测试 fixture 普遍用 `new Date(y,m,d,h)` 本地构造；`data-model.md:57` 与 AD-6（`technical-architecture.md:93`）把「固化当时本地时区」写成了解法，换机器重扫会改变历史归属。脚本里 `addDays` 已用 UTC、`today` 用本地，同一文件两套口径。

**既有约束**：`docs/product-brief.md:38` 把「不按官方计价规则反推金额」列为非目标（Spec 已约定变更）；`docs/backlog/subagent-credit-reconciliation.md` 的「不接入官方计量接口」决策保持有效；外部数据只读。

## 技术方案与关键取舍

**AD-P1 时间：单一业务时区常量 + 绝对时间存储。**
在 `src/shared/constants.ts` 增加 `BUSINESS_TZ_OFFSET_MS = 8 * 3600_000`。所有时间戳继续以 epoch ms 存储与流转；只有「哪一天」「显示几点」用 `new Date(ts + OFFSET)` 配 `getUTC*` 折算，不读 `process.env.TZ`、不读浏览器时区。日期键算术（`parseDateKey` / `addDays` / `isValidDateKey`）改用 `Date.UTC` 纯日期运算，`daySpan` 已是 UTC 解析、保持不动。
取舍：不用 `Intl` + `Asia/Shanghai`，避免引入 ICU 数据库与历史时区规则依赖，中国自 1991 年后无夏令时，固定 +8 等价且可测；不用纯 UTC 作业务日期，否则北京时间晚间用量落到前一天，破坏「今天花了多少」（AD-6 的原始理由仍成立，只换实现方式）。
**职责分离（易错点）**：`toDateKey(ts)` 是「绝对时间 → UTC+8 业务日期」的唯一入口；`formatDateKey(date)` 改为纯 UTC 日期键语义，只服务 `parseDateKey` / `addDays` / `isValidDateKey` 的日期键算术，不再用于当前时间。`todayKey()` 必须改为 `toDateKey(Date.now())`——若沿用 `formatDateKey(new Date())`，改成 UTC 语义后会取到 UTC 日期，北京时间 00:00–08:00 会显示前一天。`src/web/format.ts` 两个格式化函数用同一常量按 UTC+8 取字段。`scripts/panel-acceptance.mjs` 保持脚本独立（不 import `.ts`），在脚本内实现同一 +8 折算的 `today()`，与文件里已有的 UTC 日期算术统一。

**AD-P2 闲时列在 ETL 一次计算。**
新增 `src/shared/deepseek-offpeak.ts` 纯函数 `isDeepseekOffpeak(startedAt, holidays): boolean`，与 `date_key` 共用 `toDateKey` 的 UTC+8 折算，按 `started_at` 判定；节假日集合放 `src/shared/china-holidays.ts`（显式 `YYYY-MM-DD` 集合，只录已公布安排）。`parse.ts` 把结果写入 `ParsedRequest.isDeepseekOffpeak`，`refresh.ts` 的 INSERT 列与参数同步，`index-db.ts` 加 `is_deepseek_offpeak INTEGER NOT NULL DEFAULT 1` 并把 `SCHEMA_VERSION` 3→4。
取舍：只固化时段事实、不固化费用，官方调价只改常量、无需重扫日志；所有请求都写 0/1（不引入 NULL 与额外分支），但列说明明确「非 DS 模型的值无业务含义，其他模型不得复用」；节假日表更新属于生成规则变更，必须递增 `SCHEMA_VERSION` 触发重建。`ON CONFLICT DO UPDATE` 分支同步更新该列（它随 `excluded.started_at` 一起走），避免已有请求换文件时留下旧值。
节假日表需同时给出 `COVERED_YEARS`（已收录放假安排的年份清单）与 `HOLIDAYS`（日期集合）：判定函数只在已覆盖年份内查表，未覆盖年份一律按「周一至周五」处理，避免空集合被误读成「该年无节假日」却与已覆盖年份混用。当前数据区间（2026-10-16 ~ 11-13）不含法定节假日，表可为空集合，但必须显式标注覆盖年份。

**AD-P3 价格表、套餐与月度单价集中在 `src/shared/deepseek-pricing.ts`。**
内容：`DEEPSEEK_MODEL_MAP`（显式白名单 `deepseek-v4.1-flash` → `deepseek-flash`）、三档单价 `{ offpeak, peak }`（元 / 百万 tokens，标注 2026-11-14 价目表）、套餐参数 `{ annualFeeCny: 672, monthsPerYear: 12, monthlyBaseCredits: 4000, dailyCheckinCredits: 100 }`、纯函数 `creditUnitPrice(dateKey)` 与 `officialCost(snapshot, offpeak)`。月天数用 UTC 日期算术 `new Date(Date.UTC(y, m, 0)).getUTCDate()` 求，覆盖 28/29/30/31 天。
取舍：不落库、不放前端（口径在服务层，AD-4）；不写死某个固定单价常量（Spec R4 要求逐月变化）；参数与价目表版本写进 `docs/deepseek-pricing.md`，并记「缓存等价性」假设与其敏感性。不做历史价目表版本表（Spec 非目标），后续调价改一处常量。

**AD-P4 比率数据挂在 `/api/timeseries` 顶层新增 `ratios` 字段，不新增端点。**
`TimeseriesResponse` 扩为 `{ rows, ratios: PriceRatioRow[] }`，`PriceRatioRow = { date, ratio, wbCost, officialCost }`（两个费用字段单位为元，前端不消费，供验收手算对账）。`getTimeseries` 在原 SQL 之外再执行一条查询：复用 `buildWhere(filters)`、追加 `AND m.model IN (白名单键)`、`GROUP BY r.date_key, r.is_deepseek_offpeak`，取四列 `SUM`（input / output / cache_read / credit）。服务层按天合并两档：**分母**是两档各自按对应闲时单价算出的官方费用之和；**分子**是该天两档 `SUM(credit)` 的总和乘一次 `creditUnitPrice(date)`，不能按档各算一次分子（同一笔积分会被重复计入）。分母为 0 时 `ratio = null`。服务层只返回有 DS 请求的日期、不补空白日期；前端按连续日期轴对齐时，缺失日期补 `null` 断开折线。
取舍（Spec 留下的决策）：
- 相比**新增 `/api/price-ratio` 端点**：共用四个筛选、一次请求、与 `/api/summary` 一次返回多组指标的既有风格一致；避免前端合并两个异步数据源产生的中间态。代价是 `/api/timeseries` 职责变宽，但只增字段、不改 `rows` 的形状与语义。
- 相比**塞进 `TimeseriesRow`**：按天比率不属于「按模型」粒度，塞进每一行会让非 DS 行出现重复或空值，语义混乱。
- 筛到非 DS 模型时白名单条件自然使 `ratios` 为空数组，前端据此隐藏折线，不需要额外的「不适用」标记或提示（Spec 要求）。

**AD-P5 前端只加一条折线。**
`EChart.tsx` 注册 `LineChart`；`TrendChart.tsx` 增加可选 `ratios` prop，仅在 `metric === 'tokens'` 且 `ratios.length > 0` 时启用第二 Y 轴与折线 series，按 `days` 对齐，缺失日期为 `null`、`connectNulls: false`。`yAxis` 由对象改为数组，柱 series 显式 `yAxisIndex: 0`，折线 `yAxisIndex: 1`；右轴名称 `×`，`grid.right` 借助 `containLabel` 自适应。折线颜色用固定中性色（不与模型色表冲突），不进 `legend`（`legend.data` 固定为模型展示名数组），图例、指标卡、面板说明文字全部不变。
**必须处理的正确性点**：现有 `tooltip.formatter` 会把所有 series 的 `value` 统一交给 `formatTokens` / `formatCredit`，并把比率一起混入「过滤 0 值 + 按数值降序」的柱子列表。改法是在 `TooltipParam` 补 `seriesId`，按 `seriesId` 分流：折线单独追加一行、用 `×` 格式，不参与柱子的过滤与排序；柱子的既有逻辑不动（0 值隐藏、降序、HTML 转义保持）。自定义 `formatter` 会接管整条 tooltip，原有的全局 `tooltip.valueFormatter` 不再对柱子生效，因此柱子格式化要移进 `formatter` 内部分支调用 `formatValue`，保证柱子显示不变。否则比率会被显示成 `4` 或 `4.20` 这类错误值，柱子的缩写格式也会丢。

**AD-P6 缓存语义按 Spec R6 执行。** `cache_read_tokens` 直接视作官方缓存命中输入，界面不加提示；假设与敏感性只写进 `docs/deepseek-pricing.md`。不在运行时做第二套口径或开关（Spec 非目标）。

**实施顺序约束（影响正确性，不可并行颠倒）**：
1. AD-P1 时间口径 → 2. AD-P2 闲时列与 schema → 3. AD-P3 价格表与纯函数 → 4. AD-P4 服务层聚合并扩 API → 5. AD-P5 前端折线 → 6. 文档同步与验收。
理由：闲时判定与 `date_key` 必须共用同一 UTC+8 折算，否则按天比率与日期归属错位；比率聚合依赖预处理列与价格表；前端依赖 API 契约。测试随各自任务同步补齐，不集中到最后。

## 影响范围

| 文件 / 模块 | 改动 |
| --- | --- |
| `src/shared/constants.ts` | 新增业务时区偏移常量 |
| `src/shared/dates.ts` | `toDateKey` 改 UTC+8 折算（唯一「绝对时间 → 业务日期」入口）；`formatDateKey` 改纯 UTC 日期键语义，仅供日期算术；`parseDateKey` / `addDays` / `isValidDateKey` 改 UTC 日期算术；注释同步 |
| `src/shared/deepseek-offpeak.ts`（新） | 闲时判定纯函数 |
| `src/shared/china-holidays.ts`（新） | 法定节假日日期集合与维护说明 |
| `src/shared/deepseek-pricing.ts`（新） | 模型白名单、价目表、套餐参数、单价与官方费用纯函数 |
| `src/shared/types.ts` | `ParsedRequest` 加 `isDeepseekOffpeak`；`TimeseriesResponse` 加 `ratios`；新增 `PriceRatioRow` |
| `src/etl/parse.ts` | 由 `startedAt` 计算闲时标记 |
| `src/etl/refresh.ts` | `INSERT_REQUEST_SQL` 列清单、参数、`ON CONFLICT` 分支 |
| `src/etl/index-db.ts` | 新列；`SCHEMA_VERSION` 3→4 |
| `server/query.ts` | `getTimeseries` 增加按天 × 闲时的第二条聚合与比率计算 |
| `src/web/filters.ts` / `src/web/format.ts` | 「今天」与两个时间格式化函数改固定 UTC+8 |
| `src/web/App.tsx` / `TrendChart.tsx` / `EChart.tsx` | 把 `ratios` 传入 Token 图；双 Y 轴、折线、tooltip 分流、注册 LineChart |
| `scripts/panel-acceptance.mjs` | `today()` 统一 UTC+8；新增折线与双轴断言 |
| `tests/*` | fixture 时间戳改 `Date.UTC` 绝对构造；新增时区、闲时、月度单价、比率、API 契约测试 |
| `docs/*` | 见下节 |

## 数据或接口变化

- **数据库**：`requests` 增加 `is_deepseek_offpeak INTEGER NOT NULL DEFAULT 1`；`SCHEMA_VERSION` 3→4。旧库在 `openIndex()` 比对不匹配后按既有逻辑删除 `-wal/-shm/-journal` 并重建，不写迁移脚本、不碰 `workbuddy.db`。
- **API**：`GET /api/timeseries` 响应新增顶层 `ratios: Array<{ date: string; ratio: number | null; wbCost: number; officialCost: number }>`；`rows` 的字段、顺序、粒度完全不变。其余四个端点不变。
- **前端类型**：`TrendChartData` 不变，`TrendChart` 新增可选 `ratios` prop；`metric === 'credit'` 的积分图不传该 prop，行为不变。
- **常量与文档**：新增 `docs/deepseek-pricing.md`（价目表版本与来源、模型映射、套餐参数与原确认口径、缓存假设与敏感性、节假日表维护方式）；同步 `product-brief.md`（非目标 `:38` 改写；`:41`「不关注余额与赠送额度」保持不变——面板仍不展示余额/有效期，套餐参数只作换算常量）、`technical-architecture.md`（AD-6 改写、接口表 `/api/timeseries` 返回值、分层原则）、`data-model.md`（`date_key` 列说明与保留理由、新列说明、C5、`schema_version`）、`devops.md`（验收覆盖、节假日表更新需重建数据库）。

## 兼容与迁移方案

- 数据库可删可重建，重建成本为一次全量日志扫描（当前 483 请求 / 299 KB 数据库文件），无外部数据写入。
- **对当前 GMT+8 环境**：`date_key` 结果与改动前逐行一致，用重建前后的按天合计对照断言验证；非 GMT+8 环境的结果修正属于预期行为，跨时区测试覆盖。
- API 只增字段，既有调用方（验收脚本、面板）不因新增字段受影响；`ratios` 为空数组是合法状态。
- 前端 `metric === 'credit'` 路径、色表、0 值过滤、连续日期轴、100 天跨度上限等既有行为不变。
- 节假日表更新或生成规则调整，一律递增 `SCHEMA_VERSION`；官方调价只改 `deepseek-pricing.ts` 常量，不触发重建。

## 测试策略

- **纯函数单测**：`toDateKey` / `formatDateKey` / `addDays` / `daySpan` 覆盖 UTC、UTC+8、UTC-8 与跨零点；新增跨时区测试用 `child_process.execFileSync` 以不同 `TZ` 启动最小脚本，断言同一 epoch 输入得到相同 `date_key` 与格式化结果（Node 进程内改 `TZ` 不可靠，用子进程隔离）。
- **闲时判定**：覆盖工作日 09:00 / 11:59 / 12:00 / 14:00 / 17:59 / 18:00、周末、法定节假日、UTC 跨日，断言与官方中英文页规则一致。
- **月度单价与比率**：28 / 29 / 30 / 31 天月、跨月区间、分母为 0、分子为 0、大小月单价不同；固定 fixture 手算分子 / 分母 / 比率并逐请求对账。
- **API 契约**：`/api/timeseries` 返回 `ratios` 且 `rows` 形状不变；四个筛选对 `ratios` 生效；筛选非 DS 模型时 `ratios` 为空数组；分母为 0 的日期 `ratio: null`。
- **前端与交互验收**：`npm run acceptance` 补第二 Y 轴（右轴 `×`）、单条折线、`null` 断线、非 DS 筛选时折线消失且无提示文案、tooltip 中比率显示带 `×` 且柱子仍按原规则过滤排序；既有验收项全部继续通过。
- **必需检查**：`npm run typecheck`（独立必需项，不能被 lint / build / test 代替）、`npm test`、`npm run build`、`npm run acceptance`。仓库无 lint 脚本，不新增。
- 各任务记录自身验证；全量检查集中记在收尾任务。

## 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 缓存等价性假设不成立 | 比率方向可能反转（官方费用放大约一个数量级） | Spec 已定案按命中计；假设与敏感性写入 `docs/deepseek-pricing.md`，界面不提示 |
| 节假日表未覆盖年份 | 节假日被误判为高峰，官方费用偏高、比率偏低（保守方向） | 只录已公布安排；年度更新并递增 `SCHEMA_VERSION` |
| 官方调价 | 历史数据统一套当前价目表，存在时点误差 | 价目表标注抓取日期；改一处常量即可，不重扫 |
| 时区改动 | 非 GMT+8 环境历史 `date_key` 变化 | 重建后按固定 UTC+8 重新计算；当前环境逐行对照断言；跨时区单测 |
| tooltip 混用格式化 | 比率被显示成 token 缩写或积分小数 | AD-P5 按 `seriesId` 分流，验收脚本断言 |
| 按天比率波动大（实测 0～17×） | 折线视觉抖动 | 按 Spec 如实绘制，不平滑、不裁剪、不加说明 |
| 数据库重建 | 首次启动需全量重扫；若原始日志已被 WorkBuddy 清理，重建后请求数会少于当前 | 沿用既有「不追溯补齐已不可读数据」约定；重建前记录当前按天合计作为对照，对照结论只在日志未变化的前提下成立 |

**回滚**：按任务粒度 `git revert` 对应提交（不做 `reset --hard`）；删除 `.data/index.db*` 让旧版本按 `SCHEMA_VERSION` 自动重建；整个过程不修改、不移动、不备份 `~/.workbuddy` 下任何文件，外部数据无副作用。回滚后 `SCHEMA_VERSION` 回退同样会触发重建，属预期行为。
