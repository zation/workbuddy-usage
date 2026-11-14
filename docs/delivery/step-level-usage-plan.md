# 逐步用量口径修正与费用比率重算 Plan

依据同 topic 的 `step-level-usage-spec.md`（已固化提交）。本 Plan 只定技术方案、取舍与顺序约束，任务拆分与编号由后续 Tasks 文档负责。

## 现状分析

### 数据链路

- **字段映射**：`src/etl/fields.ts:41-85` 的 `readStep` 只从 `message.usage` 读四项 token（`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `total_tokens`），`RawStep`（`fields.ts:16-22`）不含逐步 credit、命中 / 未命中拆分与来源标记；`providerData.rawUsage` 全文未被读取，逐步 credit / `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 只存在于 `docs/integration.md:196-230` 的实测记录。
- **归并与丢弃**：`src/etl/parse.ts:40-86` 的 `mergeStep` 以 `totalTokens > target.totalTokens` 整体替换四项字段（C2），非最大步骤只贡献 `stepCount`、时间边界与模型信息（`firstModelKey` / `bestModelKey` 分别保留首次与最大值那步的模型）；`parse.ts:152-179` 只遍历 `merged.values()`，每个 `requestId` 输出一条 `ParsedRequest`。步骤明细在四处丢失：`fields.ts:47-70` 的字段过滤、`parse.ts:114-121` 的时间戳过滤、`mergeStep:76-83` 的比较替换、循环结束只输出请求行。
- **跨文件守卫**：`src/etl/refresh.ts:33-55` 的 `INSERT_REQUEST_SQL` 用 `WHERE excluded.total_tokens > requests.total_tokens` 决定同值副本保留哪一行；求和口径下这个守卫失去意义，必须重定义。
- **落库**：`src/etl/database.ts:11-79` 共六张表（`meta` + `groups` / `sessions` / `models` / `source_files` + `requests`），`SCHEMA_VERSION = 4`（`:9`），`requests` 18 列含 `is_deepseek_offpeak`（`:64`）、四项 token（`:65-68`）、`step_count`（`:71`）。`openDatabase`（`:123-157`）版本不匹配即删库重建，无迁移脚本。
- **C10 原子替换**：`refresh.ts:156-194` 每文件一个事务，`DELETE FROM requests WHERE source_file_id = ?`（`:159`）后批量插入；`src/etl/dimensions.ts:252-268` 的 `ensureSourceFile` 同事务写扫描状态。
- **积分挂接**：`refresh.ts:206` 在文件循环之外无条件执行 `attachCredits`（`src/etl/credit.ts:7-30`），只按 `credit_json` 更新 `credit` / `has_credit`（AD-7 / C6），与文件增量解耦。
- **判档**：`parse.ts:169` 按归并后的 `item.startedAt` 调 `src/shared/deepseek-offpeak.ts:10-29` 的 `isDeepseekOffpeak`，落 `requests.is_deepseek_offpeak`。该函数是纯函数，用 `BUSINESS_TZ_OFFSET_MS`（`src/shared/constants.ts:5`）折算 UTC+8，边界 `hour >= 9 && hour < 12` / `>= 14 && < 18` 为左闭右开，12:00 与 18:00 归空闲，与 Spec R3 及边界情况表一致。
- **服务层**：`server/query.ts:20-25` 的 `BASE_FROM` 是 `requests r LEFT JOIN` 三张维表；四个数据读取端点（`server/app.ts:74/82/90/106`）分别在 `getSummary`（`:99-107`）、`getTimeseries`（`:164-176`）、`getBreakdown`（`:284-296`）、`getRequests`（`:411-430`）对四项 token 做 `SUM`；模型分组 / 筛选 / 分段统一用 `m.id` 与 `m.model`，展示名用 `m.display_name`。`getBreakdown` 的 `split=model` 分段另走 `attachModelSegments`（`:340-357`）。
- **比率**：`getTimeseries:192-233` 的比率 SQL 以 `m.model IN (DEEPSEEK_MODEL_KEYS)` 过滤，按 `r.date_key, r.is_deepseek_offpeak` 分桶 `SUM` 三项 token 与 `r.credit`；分母用 `officialCost`（`src/shared/deepseek-pricing.ts:57-71`，命中 = `min(cacheRead, input)`、未命中 = `input - hit`、输出），分子用 `wbCost`（`:52-54`）；`PriceRatioRow` / `TimeseriesResponse` 形状见 `src/shared/types.ts:135-146`。
- **前端**：`src/web/App.tsx:268` 有一句旧口径说明「按请求取累计值最大的一条……」；`ModuleSectionProps.description` 是**必填** `string`（`src/web/components/ModuleSection.tsx:3-8`），渲染为模块标题下的副标题 `<p>`（`:16`），积分模块传「按请求汇总的积分消耗。」（`App.tsx:342`）；`src/web/format.ts:13-36` 的 `formatTokens` 已支持 K / M / B（1e3 / 1e6 / 1e9）与四舍五入进位，十亿级数值无需扩展。
- **测试**：直接依赖「取最大值」口径的断言集中在 `tests/parse.test.ts:87/193`、`tests/acceptance.test.ts:150/163/257`、`tests/refresh.test.ts:145`、`tests/api.test.ts` 多处硬编码数值；比率 / 判档断言在 `tests/price-ratio.test.ts`、`tests/deepseek-offpeak.test.ts`、`tests/database.test.ts:74`（列清单含 `is_deepseek_offpeak`）。e2e 固定样本 `tests/e2e/sample.ts:68-85` 每个请求恰好 1 步、无 `rawUsage`，`tests/e2e/expectations.ts:131-313` 的期望值全部由样本推导，比率推导在 `:214-239` 按请求 `isDeepseekOffpeak(timestamp)` 判档。

### 结论

1. 口径反转不只是改数字：C2 的替换逻辑、跨文件副本守卫、C3 / C4 的校验对象、比率分桶、界面旧文案与全部测试期望值都必须一起改，任何单点改动都会留下新旧口径混用的中间态。
2. `officialCost` / `wbCost` / `isDeepseekOffpeak` / `creditUnitPrice` 四个纯函数都可原样复用，价目表常量、套餐参数与节假日数据不需要改；本次改的是「喂给这些函数的粒度」。
3. `SCHEMA_VERSION` 4 → 5 会触发删库全量重扫，外部 `workbuddy.db` 只读不变（AC8）。

## 技术方案与关键取舍

### AD-P1 请求级 token 以派生列落库，四个主聚合 SQL 不动（已确认，按长期最佳实践定案）

新增 `steps` 表，一行一步；`requests` 的四项 token 列**继续保留为解析层求和后的派生值**。四个数据读取端点的 SQL、JOIN、分组与排序结构完全不改，只有数值变化。

- **这是纯技术实现选择，A 不改变任何 API 契约与产品语义**：`requests` 本来就是解析层产出的请求级快照（`date_key` 同样是解析层固化的派生列），四项 token 从「取最大值」换成「求和」只是换算法，写入路径唯一。B 会让 `getRequests` 的明细行语义变成 step 行、需要回头修订 Spec R2 / R9 / AC5，已超出纯技术范围。
- **选择理由**：R9 / AC5 要求字段、顺序、粒度与 `rows` / `ratios` 形状不变。若改为 `JOIN steps` 实时聚合，`getTimeseries` 的 `GROUP BY date_key, m.id`、`getBreakdown` 的 `split=model` 分段、`getRequests` 的逐行明细与 `COUNT(*)` / `COUNT(DISTINCT r.session_id)` 都会被放大成 step 行数，请求数与会话数必须靠 `COUNT(DISTINCT r.request_id)` 兜住，回归面积大且容易漏。四个主聚合 SQL、JOIN、`buildWhere`、模型分组 / 分段 / 排序全部不动，是最小改动面；查询端也不必每次对约 1 万步做 JOIN 聚合。派生列落库与既有「`date_key` 在解析层固化」同构，符合「口径只存在于解析层与服务层」（AD-2 / AD-4）。
- **代价与兑付**：四项 token 在 `steps` 与 `requests` 两处存在「受控冗余」，由三道约束兑付单一真源的顾虑——写入路径唯一（仅解析层归并时求和）、C10 同事务双删、单测断言「请求行四项 = Σ 该请求 steps 四项」。这与项目已接受的 `date_key` 冗余同构。
- **未选 B 的原因**：单一真源虽更干净，但四个端点、分段、计数与排序的 SQL 全改，且属契约变更。**定案 A，无需修订 Spec**。
- **影响正确性的约束**：C10 的 `DELETE FROM requests WHERE source_file_id = ?` 必须**在同一事务内同时删除该文件的 steps 行**（`steps` 带 `source_file_id`，或在删 requests 前按 `request_id` 子查询删除）。只删 requests 会让增量刷新后旧步骤残留、数值虚高。

### AD-P2 判档结果落 step 级列，沿用 SCHEMA_VERSION 重建机制（已确认，开发者指定）

`isDeepseekOffpeak(step.timestamp)` 在解析层算好，落 `steps.is_deepseek_offpeak`；服务层比率 SQL 改为 JOIN `steps` 后按 `r.date_key, s.is_deepseek_offpeak` 分桶。`requests.is_deepseek_offpeak` 列删除，`tests/database.test.ts:74` 的列清单断言同步。

**字段语义澄清**：`is_deepseek_offpeak` 是「按 DeepSeek 官方高峰 / 空闲规则判出的档位」（1 = 空闲、0 = 高峰），判据只有该步的绝对时间戳（UTC+8、工作日 09:00–12:00 与 14:00–18:00 为高峰，周末与法定节假日全天空闲），**与「这一步是不是 DS 模型」无关**。所有模型的步骤都填 0/1，只有 DS 白名单请求的分母计算消费它。这与现行 `requests.is_deepseek_offpeak` 的既有语义（`docs/data-model.md:47`）一致，只是判定对象从请求最早时间换成每一步自己的时间。

- **选择理由**：判定一次性固化，不会出现「同一份历史数据因节假日表版本不同而在不同时间查出不同比率」，直接满足 R8；节假日表更新沿用既有机制——递增 `SCHEMA_VERSION` → 删库重建 → 全部历史步骤按新表重判，`docs/deepseek-pricing.md`「节假日表维护」与 `docs/devops.md`「节假日表更新」只需把「请求级 `is_deepseek_offpeak`」改成「步骤级」，机制不变；AC7 由纯函数 + 绝对时间戳保证。
- **未选 B 的原因**：查询时按 `s.timestamp` 实时判档虽免去重建，但 R8 的「按新规则一致重算」变成隐式行为，两处长期文档的既有说明要整段删除，且每个比率查询都要对全部 DS 步骤在 JS 侧判档。**定案 A**（开发者：闲时标志直接放在 step 上）。验证方式：构造「改节假日表前后」的 fixture，递增 `SCHEMA_VERSION` 触发重建后，断言历史比率按新表一致变化。
- **两种方案的共同要求**：`date_key` 仍取请求最早步骤的 UTC+8 业务日（R2 / C5），**日期归属按请求、档位按步骤**，跨零点长请求仍归入 `started_at` 所在业务日，但各步按自身时间戳判档。不得把 steps 的业务日当作统计日。

### AD-P3 请求级模型取第一步，服务层分组语义不变

`parse.ts` 归并已保留 `firstModelKey` / `firstModelName`（`:70-73`），但 C2 用的是最大值那步的 `bestModelKey`。本次把请求级模型改用 `firstModelKey`，`refresh.ts` 的 `ensureModel` 入参随之替换；`steps` 行保留各自 `model` 仅供对账与告警，不参与聚合分组与筛选。多模型时在 `mergeStep` 里比较当前步骤 model 与 `firstModelKey`，不一致累计进 `FileParseResult.warnings`（沿用既有告警通道），不改变归属、不按 token 占比选举、不按步分摊。服务层仍按 `m.model` 分组 / 筛选 / 堆叠 / 分段，JOIN 不变。

### AD-P4 比率分母改为「步骤 × 档位」，分子必须按请求去重

- **分母**：以 `steps s JOIN requests r` 为源，`m.model IN (DEEPSEEK_MODEL_KEYS)` 过滤，按 `r.date_key + s.is_deepseek_offpeak` 分桶累加 `SUM(s.cache_read_tokens)`、`SUM(s.input_tokens - s.cache_read_tokens)`、`SUM(s.output_tokens)`，再套 `officialCost` 两档相加。命中 / 未命中的拆分按步算再求和，与 `officialCost` 里 `Math.min(cacheRead, input)` 的防御保持一致。
- **分子（最高风险点）**：现有 `SUM(r.credit)` 一旦 JOIN `steps` 会被放大成「每步重复一次 credit」，直接把比率乘上步骤数。必须改为**按请求独立聚合**（先按 `r.request_id` 汇总 credit 与 `r.date_key` 得分子，再与分母按日期合并；或走独立的请求级子查询），不能与分母共用同一条 JOIN 结果。`Σ(credit_json[request_id]) × 单价(该请求 date_key 所属月)` 的语义、跨月单价、`has_credit` 不参与展示全部不变。
- **分支保持**：分母 0 → `null`、分子 0 → 0、只返回有 DS 请求的日期、范围内无 DS 请求 `ratios` 为空数组，沿用 `query.ts:223-233`；`PriceRatioRow` / `TimeseriesResponse` 形状不变。
- **交叉验证**：AC4 的 `credit ÷ 逐步官方费用 ≈ 0.04 元/积分` 在闲时组与高峰组应接近，能立刻暴露分子被放大或分母漏档的问题。

### AD-P5 顺序约束（必须写进实施安排）

1. 先改 `src/etl/fields.ts` 的 `RawStep` / `readStep`（四项 token 语义改为本步值、去掉「累计值」注释），再改 `parse.ts` 归并，最后改 `refresh.ts` 写库；类型先行，避免中间态把旧口径写进新表。
2. `SCHEMA_VERSION` 递增、新表建表、C10 同事务双删必须**同批提交**。只改结构不递增版本会读到旧库；递增了版本却漏删 steps 会造成重复计数。
3. 删除 `requests.is_deepseek_offpeak` 列与 `query.ts` 比率 SQL 改 JOIN steps 必须同批，否则中间态引用不存在的列。
4. 测试期望值在口径代码改完后统一重算，禁止保留「取最大值」分支或放宽断言来迁就旧数字；`tests/e2e/expectations.ts` 的推导函数必须与服务端同口径（按步求和、按步判档），本机实测数字只作量级参照，不写成常量。
5. 六份长期文档在实现稳定后一次性同步，最后跑 `npm run acceptance`；文档与代码不得出现已知矛盾（AC10）。

### AD-P6 界面文案（已确认，按字段事实定案）

`description` 是 `ModuleSectionProps` 的**必填** `string`（`src/web/components/ModuleSection.tsx:3-8`），渲染为模块标题下的副标题 `<p>`（`:16`）。Token 模块现传「按请求取累计值最大的一条，输入 / 输出 / 缓存命中与合计同源。」（`App.tsx:268`，旧口径解释），积分模块传「按请求汇总的积分消耗。」（`App.tsx:342`，口径无关的中性描述）。

定案：把 `description` 改为可选 `description?: string`，组件仅在有值时渲染 `<p>`；Token 模块不再传该 prop。这样 Spec「移除旧口径说明，不替换为任何口径说明」严格成立，**不需要「中性文案」这个例外**，也不新增任何界面元素与文案；积分模块仍传原值、渲染不变。原先「保留中性文案是否算违反 Spec」的疑问随之消失。图表配置、色表、tooltip 分流、`format.ts` 全部不动。

## 影响范围

| 层 | 文件 | 变更 |
| --- | --- | --- |
| 解析层 | `src/etl/fields.ts` | `RawStep` 保留四项 token 并明确为「本步值」；补步骤序号 / 模型 / 来源标记；去掉累计值注释 |
| 解析层 | `src/etl/parse.ts` | `mergeStep` 从「取最大」改为「求和 + 产出 steps」；模型取 `firstModelKey`；按步判档；多模型告警；`step_count` 等于 steps 条数；C3 / C4 校验对象改为求和结果 |
| 解析层 | `src/etl/refresh.ts`、`src/etl/dimensions.ts` | 新增 steps 写入；C10 事务内双删；跨文件副本守卫改为按 `request_id` 只留一行并告警 |
| 数据库 | `src/etl/database.ts` | `SCHEMA_VERSION` 4 → 5；新增 `steps` 表与 `request_id` / `source_file_id` 索引；删除 `requests.is_deepseek_offpeak` 列 |
| 服务层 | `server/query.ts` | 仅 `getTimeseries` 的比率 SQL 改 JOIN steps 分桶、分子按请求去重；四个主聚合 SQL 与 `buildWhere` 不动 |
| 共享层 | `src/shared/deepseek-pricing.ts`、`deepseek-offpeak.ts`、`constants.ts`、`types.ts` | 不改函数与常量；`types.ts` 新增内部 Step 类型、让 `ParsedRequest` 携带 Step 事实并移除请求级 `isDeepseekOffpeak`、扩展告警键，对外的 API 契约类型不变 |
| 前端 | `src/web/App.tsx`、`src/web/components/ModuleSection.tsx` | Token 模块不再传 `description`；`description` 改为可选并条件渲染；积分模块与 `format.ts` 不动 |
| 测试 | `tests/*.test.ts`、`tests/e2e/*`、`tests/helpers/*`、`scripts/e2e-fixture.mjs` | 期望值按新口径重算；e2e 样本扩展为多步骤 + 跨档 + DS / 非 DS；推导函数改按步 |
| 长期文档 | `product-brief.md`、`technical-architecture.md`、`data-model.md`、`integration.md`、`deepseek-pricing.md`、`devops.md` | 按 Spec「与既有交付的关系」清单同步；含 `technical-architecture.md` 的「五张表 + 一张配置表」「测试分层里五个端点」两处表述 |

**不改**：API 契约形状、价目表 / 套餐 / 节假日常量、外部数据（R10）、依赖清单、部署与版本策略、`docs/delivery/v1.0.0/` 归档文档与已完成交付文档。

## 数据与接口变化

- **数据库**：新增 `steps` 表，一行一次模型调用，含业务键 `request_id`、`source_file_id`、步骤序号、`timestamp`、四项 token、`model`、`is_subagent`、`is_deepseek_offpeak`；`requests` 四项 token 变为由该请求全部步骤求和派生；删除请求级 `is_deepseek_offpeak`；`SCHEMA_VERSION` 4 → 5，删库重建，无迁移脚本。全表仍以内部 `id` 做主键、业务键建 UNIQUE，内部 `id` 不出 API（C14）。
- **API**：四个数据读取端点的路径、参数、字段、顺序、粒度与 `rows` / `ratios` 形状全部不变，只有数值变化；`/api/refresh` 与 `/api/health` 响应不变。
- **前端**：无新增元素与文案，仅移除一句既有说明。
- **配置**：不新增环境变量、不新增配置项。

## 兼容与迁移方案

- 沿用 `openDatabase`（`database.ts:123-157`）的版本不匹配删库重建：4 → 5 触发一次全量日志重扫。逐步入库后库体积与解析耗时都会上升，重建耗时需实测并记录，不预设阈值。
- 增量刷新按 C10 在同一事务内先删该文件的 `requests` 与 `steps` 行，再插入本次解析结果；`source_files` 的扫描状态同事务更新（C9）。`attachCredits` 仍在文件循环外独立执行，按 `request_id` 挂接 `credit_json`，不受 steps 影响。
- 跨文件同值副本：守卫从 `excluded.total_tokens > requests.total_tokens` 改为按 `request_id` 只保留一行并计入 `duplicateRequestIds` 告警；副本的 steps 也不得重复插入，通过 `steps.request_id` 的唯一约束或插入前清理保证。求和后两副本数值应相等，不再用大小比较选优。
- 历史数据全部按新口径重算，不提供旧口径并列展示或回退开关（Spec 非目标）。
- 外部 `~/.workbuddy` 全程只读；AC8 校验 `workbuddy.db` 及 `-wal` / `-shm` 的 size 与 mtime 不变。
- 时区：判档与 `date_key` 仍用 `BUSINESS_TZ_OFFSET_MS` 把绝对时间折算成 UTC+8 后固化，不读运行进程时区；AC7 在至少两种 `TZ` 下比对 `date_key`、每步档位、比率序列与格式化结果。

## 测试策略

- **解析层 / 纯函数（Vitest）**：单步请求新旧口径一致；多步求和等于手算 Σ步骤；上下文压缩回落前后都计入；`step_count` = steps 条数且请求行四项 = Σ steps 四项；请求级模型取第一步、多模型 fixture 断言归属不变且告警被记录、无按步分摊；C3 / C4 在求和后成立；跨文件副本与同文件二次解析不重复计数（含 steps）；按步判档覆盖 09:00 / 12:00 / 14:00 / 18:00 边界、周末、节假日、未覆盖年份与跨零点长请求。
- **服务层（Vitest）**：四个端点响应结构 `toEqual` 不变、只有数值变化；比率分子按请求去重（构造多步 DS 请求断言分子不被放大）；分母按 `(r.date_key, s.is_deepseek_offpeak)` 分桶、跨档长请求分别计价；分母 0 → `null`、分子 0 → 0、跨月各用各自单价、无 DS 请求 `ratios` 为空；AC4 用固定 fixture 断言隐含单价在闲时组与高峰组接近。
- **跨时区**：扩展 `tests/price-ratio.test.ts:146` 的既有跨 TZ 用例到逐步档位；至少两种 `TZ` 下比对 `date_key`、逐步档位、比率序列与格式化结果，覆盖 UTC+8 零点与峰谷边界。
- **交互验收（Playwright）**：把 `tests/e2e/sample.ts` 从「每请求 1 步」扩展为含多步骤、跨 09:00 / 12:00 / 14:00 / 18:00 档位、含 DS 与非 DS 模型的固定样本，`tests/helpers/jsonl.ts` 同步支持逐步行；`tests/e2e/expectations.ts` 的推导改为按步求和 + 按步判档，期望值仍从样本确定性推出、不硬编码；`sample.spec.ts` 自检同步；AC6 补「旧口径说明文案已移除」与 K / M / B 格式断言；AC9 既有回归项全部通过。样本仍只用 `message.usage` 四项 + `providerData`，不伪造 `rawUsage`（Spec 非目标：逐步 credit 不进入统计口径）。
- **全量检查（收尾）**：`npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance`；类型检查是独立必需项，不能被 lint / build / 测试代替。
- **基线**：Spec 依据段的本机数字（80.6M → 1,845.6M、4.16× → 0.203× 等）只作量级参照，原始日志变化后按同一口径重算，不写死为断言常量。

## 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 分子被 JOIN steps 放大 | 比率被乘上步骤数，方向与事实相反 | AD-P4 独立请求级子查询；AC3 / AC4 固定 fixture 与隐含单价交叉验证 |
| C10 未同步删 steps | 增量刷新后步骤重复计数 | AD-P5 同事务双删；单测覆盖同文件二次解析与跨文件副本 |
| 请求数 / 会话数被 step 行放大 | 四个端点计数语义错误 | AD-P1 已定派生列方案，主聚合 SQL 不动（仅后续改选 B 才需要 `COUNT(DISTINCT)`） |
| 判档落库后节假日表更新未重建 | 历史比率残留旧判定 | AD-P2 沿用 `SCHEMA_VERSION` 递增；文档与 `tests/database.test.ts` 列清单同步；构造改表前后 fixture 验证 |
| 日期归属误用步骤业务日 | 跨零点长请求被拆到两天 | AD-P2 明确「日期按请求 `r.date_key`、档位按步骤」，边界情况表单列用例 |
| 逐步入库体积与耗时上升 | 重建变慢、数据库变大 | 实测重建耗时写入实施记录；不引入新依赖、不加缓存层 |
| 旧口径界面文案残留 | 界面显示错误说明 | AC6 明确断言已移除 |
| 大量测试期望值需重算 | 为迁就实现而放宽断言 | 期望值统一由 fixture / 样本推导，禁止写死本机数字；不删除、不跳过既有用例 |

**回滚**：`git revert` 本交付的提交后，`SCHEMA_VERSION` 回到 4，下次启动自动删库重建回旧口径；无需 `npm install`、无需清理外部状态。派生库可删可重建，回滚无数据风险，成本只是一次全量重扫。若已同步六份长期文档，回滚时一并 revert，避免文档与代码矛盾。

## 取舍确认记录

1. **AD-P1 定案 A**（开发者授权按长期最佳实践决定）：请求级四项 token 以派生列落库，四个主聚合 SQL 不动。属纯技术实现选择，不改变 API 契约，无需修订 Spec；B 会改 `getRequests` 明细行语义，属契约变更。
2. **AD-P2 定案 A**（开发者指定「闲时标志直接放在 step 上」）：`is_deepseek_offpeak` 落 `steps`，请求级列删除，沿用递增 `SCHEMA_VERSION` 删库重建；`deepseek-pricing.md` / `devops.md` 的节假日维护说明只把「请求级」改成「步骤级」，机制不变。
3. **AD-P6 定案「可选 prop」**（开发者询问 `description` 是什么后按字段事实决定）：该字段必填且渲染为副标题，改为可选 + 条件渲染，Token 模块不传；无需中性文案，Spec 不修订。

三项取舍均已落定，Plan 无待确认问题。按约定，开发者确认本 Plan 后先做一次 docs 提交把 Plan 固化到版本库，再进入任务拆分。
