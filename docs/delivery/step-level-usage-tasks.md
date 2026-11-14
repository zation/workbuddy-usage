本 Tasks 对应 [step-level-usage-spec.md](./step-level-usage-spec.md)（Spec，`7427327` 固化）与 [step-level-usage-plan.md](./step-level-usage-plan.md)（Plan，`6ee2a1f` 固化）。任务编号稳定，不表示必须严格串行；实施时按 AGENTS.md 第 4 节逐个完成、逐个验证、逐个提交。

## 执行顺序与依赖

- **T002 与 T003 是一个原子批次，必须连续完成、统一验证、合并为一个提交**：AD-P5.2 要求 `SCHEMA_VERSION` 递增、新 `steps` 表、C10 同事务双删同批；AD-P5.3 要求删 `requests.is_deepseek_offpeak` 列与 `query.ts` 比率 SQL 改 JOIN `steps` 同批。T002 单独完成时 `query.ts` 仍引用已删列，比率相关用例必然失败。合并提交正文按 AGENTS.md 第 6 节同时列出 `Tasks: T002, T003`，与既有交付 `time-range-group-split` 的 T004 / T005 处理一致。
- **T001 先于 T002**（AD-P5.1 类型先行）：T001 是纯增量，先定义 Step 事实与求和派生、暂不删请求级档位字段，保证中间态只新增能力、不把旧口径写进新结构；T002 再切结构并开始写 `steps`。
- T003 依赖 T002（同一原子批次）；T004 依赖 T002、T003、T005（服务端口径稳定后统一重算期望值，AD-P5.4；且「旧口径说明文案已移除」的验收断言依赖 T005 的产物）；T006 依赖 T001、T003；T005 无前置技术依赖、可与 T001–T003 并行，但必须先于 T004 完成；T007 依赖 T001–T006（AD-P5.5 实现稳定后一次性同步）；T008 为收尾任务，依赖 T001–T007，按 AGENTS.md 不填「提交」字段。
- 各已实施任务的 commit hash 在收尾检查通过后统一回填，随收尾提交纳入；任务提交正文须带 `Tasks-Doc: step-level-usage-tasks.md` 与对应 `Tasks: T00x`，Spec / Plan / Tasks 的文档确认提交不带这两个字段。
- 测试期望值一律由固定 fixture / 样本确定性推导，禁止写死本机实测数字、放宽断言或跳过既有用例（AD-P5.4 / Spec AC1、AC3）。
- 影响正确性、兼容性的其余顺序约束见 Plan「AD-P5 顺序约束」，本文件不重复。

# T001 逐步用量事实的解析归并

状态：pending

目标与完成条件：按 Spec R1 / R2 / R3 与 Plan AD-P3 建立逐步用量事实层。`readStep` / `RawStep` 明确四项 token 为「本步值」、补齐 Step 事实所需字段、去掉累计值注释；`mergeStep` 从「取 `total_tokens` 最大那条」改为四项求和并产出该请求全部 Step 事实，请求级四项 token 为求和派生值，`step_count` 等于 Step 条数；请求级模型取第一步标识，请求内出现多模型时经 `ParseWarnings` 记录告警但不改变归属、不按 token 占比选举、不按步分摊、不展示多模型；每步用 `isDeepseekOffpeak` 按自身时间戳判档；C3 / C4 校验对象改为求和结果。本任务为**纯增量**：不删请求级 `isDeepseekOffpeak`、不动数据库与写库，保证 typecheck 与既有写库路径不中断；四项 token 改为求和后，旧库（schema 4）中未重扫的历史行仍是旧值，由 T002 递增版本删库重建统一，本阶段不单独提供混合口径的一致性保证。完成条件：解析层单测覆盖单步请求新旧一致、多步求和等于手算 Σ、上下文压缩回落前后都计入、`step_count` 与 Step 条数一致、`ParsedRequest` 四项 = Σ 各步四项（本阶段在解析层验证，`steps` 表由 T002 建立）、请求级模型取第一步且多模型告警被记录且无按步分摊、C3 / C4 求和后成立、按步判档覆盖 09:00 / 12:00 / 14:00 / 18:00 边界与周末 / 节假日 / 跨零点长请求；`npm run typecheck` 通过。

修改范围：`src/etl/fields.ts`、`src/etl/parse.ts`、`src/shared/types.ts`、`tests/parse.test.ts`

# T002 数据库结构与写库切换

状态：pending

目标与完成条件：按 Spec R2 / R8 / AC8 与 Plan AD-P1 / AD-P2 / AD-P5 把数据库与写库切到逐步口径。`SCHEMA_VERSION` 4 → 5，新增 `steps` 表（一行一次模型调用，含业务键 `request_id` / `source_file_id`、步骤序号、时间戳、四项 token、模型、来源标记、按步档位）与必要索引，删除 `requests.is_deepseek_offpeak` 列及 `ParsedRequest` 对应字段，并同步删除 `parse.ts` 中该字段的构造（`isDeepseekOffpeak` 函数仍保留供按步判档使用）；`refresh.ts` 在同一事务内写入请求行与全部 Step 行、C10 按 `source_file_id` 同事务双删 `requests` 与 `steps`、跨文件同值副本守卫改为按 `request_id` 只留一行并计入 `duplicateRequestIds` 告警且副本步骤不重复插入，`WARNING_KEYS` 同步 T001 扩展的告警键；`attachCredits` 仍按请求挂接 `credit_json`、与 steps 解耦。请求行四项 token 写求和派生值（AD-P1）。完成条件：结构列清单与版本号单测、「请求行四项 = Σ 该请求 steps 四项」、同文件二次解析与跨文件副本不重复计数（含 steps）、旧库启动自动删库重建、重建前后请求数一致且外部 `workbuddy.db` 及 `-wal` / `-shm` 的 size / mtime 不变（AC8）；与 T003 合并为同一原子提交并统一验证（见「执行顺序与依赖」）；`npm run typecheck` 通过。

必要依赖：T001

修改范围：`src/etl/database.ts`、`src/etl/refresh.ts`、`src/etl/parse.ts`、`src/etl/dimensions.ts`、`src/shared/types.ts`、`tests/database.test.ts`、`tests/refresh.test.ts`

# T003 服务层比率重算

状态：pending

目标与完成条件：按 Spec R4 / R5 / R6 / R7 / AC3 / AC4 与 Plan AD-P4 重写 `getTimeseries` 的比率聚合。分母以 `steps s JOIN requests r` 为源，`m.model IN (DEEPSEEK_MODEL_KEYS)` 过滤，按 `r.date_key + s.is_deepseek_offpeak` 分桶累加各步命中 / 未命中输入与输出后套 `officialCost` 两档相加；分子改为按请求独立聚合（请求级子查询按 `request_id` 汇总 `credit` 与 `date_key`），不得与分母共用 JOIN 结果而把 `credit` 放大成每步一份；复用 `wbCost` 与跨月单价；分母 0 → `null`、分子 0 → 0、只返回有 DS 请求的日期、无 DS 请求 `ratios` 为空数组等分支保持，`PriceRatioRow` / `TimeseriesResponse` 形状不变。四个主聚合 SQL、`buildWhere`、模型分组 / 分段 / 排序不动（AD-P1 / R9），日期归属仍按请求 `r.date_key`、档位按步骤。完成条件：比率单测覆盖分子不被多步 DS 请求放大、跨档长请求分别计价、分母 0 / 分子 0 / 跨月单价 / 无 DS 请求空数组、四个筛选生效（含非 DS 模型）、`rows` 结构与既有端点响应 `toEqual` 只有数值变化（AC5）；AC4 隐含单价在闲时组与高峰组接近；`npm run typecheck` 通过；与 T002 合并为同一原子提交并统一验证（见「执行顺序与依赖」）。

必要依赖：T002

修改范围：`server/query.ts`、`tests/price-ratio.test.ts`、`tests/api.test.ts`、`tests/acceptance.test.ts`

# T004 e2e 固定样本与期望值扩展

状态：pending

目标与完成条件：按 Spec AC1 / AC2 / AC3 / AC6 与 Plan「交互验收」把 e2e 固定样本从「每请求 1 步」扩展为含多步骤、跨 09:00 / 12:00 / 14:00 / 18:00 档位、DS 与非 DS 模型的样本，`tests/helpers/jsonl.ts` 同步支持逐步行；`tests/e2e/expectations.ts` 的推导函数改为与服务端同口径（按步求和、按步判档），期望值仍从样本确定性推出、不硬编码本机实测数字；样本只用 `message.usage` 四项 + `providerData`，不伪造 `rawUsage`；`sample.spec.ts` 自检同步；AC6 补「旧口径说明文案已移除」与 K / M / B 格式断言，AC9 既有回归项继续通过。完成条件：`npm run acceptance` 通过，或如实记录未执行原因。

必要依赖：T002、T003、T005

修改范围：`tests/e2e/`、`tests/helpers/jsonl.ts`、`scripts/e2e-fixture.mjs`

# T005 前端旧口径文案移除

状态：pending

目标与完成条件：按 Spec「用户或系统行为」/ AC6 与 Plan AD-P6 移除界面旧口径说明。`ModuleSectionProps.description` 改为可选 `string`、组件仅在有值时渲染副标题 `<p>`，Token 模块不再传该 prop，积分模块仍传原值且渲染不变；不替换为任何口径说明、不新增界面元素与文案。图表配置、色表、tooltip 分流、`format.ts` 不动。完成条件：前端相关单测与 `npm run typecheck` 通过，交互验收断言界面无该说明文案且无本次新增说明文字。

修改范围：`src/web/App.tsx`、`src/web/components/ModuleSection.tsx`、`tests/`

# T006 跨时区与判档回归补强

状态：pending

目标与完成条件：按 Spec AC7 与 Plan「跨时区」把逐步口径纳入回归。扩展 `tests/price-ratio.test.ts` 的既有用例，以至少两种 `TZ` 子进程比对同一组绝对时间戳下的 `date_key`、每步档位、比率序列与时间格式化结果一致，覆盖 UTC+8 零点与 09:00 / 12:00 / 14:00 / 18:00 峰谷边界；沿用固定 fixture，不依赖运行进程时区；`tests/timezone.test.ts` 的日期键与格式化用例按逐步档位同步，判档纯函数的边界用例仍由 `tests/deepseek-offpeak.test.ts` 覆盖、不重复改写。完成条件：`npm test` 中该跨 TZ 用例在多种 TZ 下均执行且通过，`npm run typecheck` 通过。

必要依赖：T001、T003

修改范围：`tests/price-ratio.test.ts`、`tests/timezone.test.ts`

# T007 长期文档同步

状态：pending

目标与完成条件：按 Spec「与既有交付的关系」/ AC10、Plan AD-P5.5 与 AGENTS.md 第 5 节，在实现稳定后一次性同步六份长期文档：`product-brief.md`（关键术语「累计用量」→ 逐步语义）、`technical-architecture.md`（AD-2，及「五张表 + 一张配置表」「测试分层里五个端点」两处表述）、`data-model.md`（Step 实体落库、C2 / C3 / C4、请求级 `is_deepseek_offpeak` 列处置、关系图、`schema_version` 4 → 5）、`integration.md`（逐步用量特性、字段实测对应、各类 credit 数据源粒度与统计口径边界）、`deepseek-pricing.md`（分母逐步分档、摊销费用命名、节假日表维护改为步骤级）、`devops.md`（交互验收覆盖、删索引重建、节假日表更新）。`integration.md` 除「累计用量特性」整节、字段表「累计值」标注与「实测 40 倍，绝不求和」外，还须清除事件类型表 `function_call` 行、兼容性风险表「`usage` 语义变化 / 累计值非单调」两行、实测快照段「累计值回退」与「按请求取最大值合计 / 逐条累加约 39.8 倍」等旧口径表述；`technical-architecture.md`「测试分层里五个端点」按四个数据读取端点 + `/api/health` + `/api/refresh` 的实际路由改写。`docs/delivery/v1.0.0/` 归档与已完成交付文档不改写。完成条件：文档与代码无已知矛盾，旧口径说明已清除，节假日维护说明按 Plan「取舍确认记录」的 AD-P2 定案（判档落库）书写。

必要依赖：T001、T002、T003、T004、T005、T006

修改范围：`docs/`

# T008 交付收尾检查

状态：pending

目标与完成条件：按 AGENTS.md 第 5 节与 Spec AC1–AC10 逐项收尾：核对验收标准全部满足、各任务状态与实施记录准确完整、各已实施任务的「提交」字段已回填对应 commit hash、全量执行 `npm run typecheck` / `npm test` / `npm run build` / `npm run acceptance` 并如实记录结果与未执行原因（类型检查为独立必需项，不能被 lint / build / 测试代替）、六份长期文档与实际实现一致、`docs/backlog/` 与本次交付相关条目已检查、旧交付文档未被改写；记录重建耗时与已知限制（请求内多模型、团队子代理积分、子代理积分缺口）。完成后做收尾提交，收尾任务本身不填「提交」字段。

必要依赖：T001、T002、T003、T004、T005、T006、T007

修改范围：`docs/delivery/step-level-usage-tasks.md`、`docs/`
