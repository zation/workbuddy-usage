本 Tasks 对应 [step-level-usage-spec.md](./step-level-usage-spec.md)（Spec，`7427327` 固化）与 [step-level-usage-plan.md](./step-level-usage-plan.md)（Plan，`6ee2a1f` 固化）。任务编号稳定，不表示必须严格串行；实施时按 AGENTS.md 第 4 节逐个完成、逐个验证、逐个提交。

## 执行顺序与依赖

- **T002 与 T003 是一个原子批次，必须连续完成、统一验证、合并为一个提交**：AD-P5.2 要求 `SCHEMA_VERSION` 递增、新 `steps` 表、C10 同事务双删同批；AD-P5.3 要求删 `requests.is_deepseek_offpeak` 列与 `query.ts` 比率 SQL 改 JOIN `steps` 同批。T002 单独完成时 `query.ts` 仍引用已删列，比率相关用例必然失败。合并提交正文按 AGENTS.md 第 6 节同时列出 `Tasks: T002, T003`，与既有交付 `time-range-group-split` 的 T004 / T005 处理一致。
- **T001 先于 T002**（AD-P5.1 类型先行）：T001 是纯增量，先定义 Step 事实与求和派生、暂不删请求级档位字段，保证中间态只新增能力、不把旧口径写进新结构；T002 再切结构并开始写 `steps`。
- T003 依赖 T002（同一原子批次）；T004 依赖 T002、T003、T005（服务端口径稳定后统一重算期望值，AD-P5.4；且「旧口径说明文案已移除」的验收断言依赖 T005 的产物）；T006 依赖 T001、T003；T005 无前置技术依赖、可与 T001–T003 并行，但必须先于 T004 完成；T007 依赖 T001–T006（AD-P5.5 实现稳定后一次性同步）；T008 为收尾任务，依赖 T001–T007，按 AGENTS.md 不填「提交」字段。
- 各已实施任务的 commit hash 在收尾检查通过后统一回填，随收尾提交纳入；任务提交正文须带 `Tasks-Doc: step-level-usage-tasks.md` 与对应 `Tasks: T00x`，Spec / Plan / Tasks 的文档确认提交不带这两个字段。
- 测试期望值一律由固定 fixture / 样本确定性推导，禁止写死本机实测数字、放宽断言或跳过既有用例（AD-P5.4 / Spec AC1、AC3）。
- 影响正确性、兼容性的其余顺序约束见 Plan「AD-P5 顺序约束」，本文件不重复。

# T001 逐步用量事实的解析归并

状态：done

目标与完成条件：按 Spec R1 / R2 / R3 与 Plan AD-P3 建立逐步用量事实层。`readStep` / `RawStep` 明确四项 token 为「本步值」、补齐 Step 事实所需字段、去掉累计值注释；`mergeStep` 从「取 `total_tokens` 最大那条」改为四项求和并产出该请求全部 Step 事实，请求级四项 token 为求和派生值，`step_count` 等于 Step 条数；请求级模型取第一步标识，请求内出现多模型时经 `ParseWarnings` 记录告警但不改变归属、不按 token 占比选举、不按步分摊、不展示多模型；每步用 `isDeepseekOffpeak` 按自身时间戳判档；C3 / C4 校验对象改为求和结果。本任务为**纯增量**：不删请求级 `isDeepseekOffpeak`、不动数据库与写库，保证 typecheck 与既有写库路径不中断；四项 token 改为求和后，旧库（schema 4）中未重扫的历史行仍是旧值，由 T002 递增版本删库重建统一，本阶段不单独提供混合口径的一致性保证。完成条件：解析层单测覆盖单步请求新旧一致、多步求和等于手算 Σ、上下文压缩回落前后都计入、`step_count` 与 Step 条数一致、`ParsedRequest` 四项 = Σ 各步四项（本阶段在解析层验证，`steps` 表由 T002 建立）、请求级模型取第一步且多模型告警被记录且无按步分摊、C3 / C4 求和后成立、按步判档覆盖 09:00 / 12:00 / 14:00 / 18:00 边界与周末 / 节假日 / 跨零点长请求；`npm run typecheck` 通过。

修改范围：`src/etl/fields.ts`、`src/etl/parse.ts`、`src/shared/types.ts`、`tests/parse.test.ts`、`tests/api.test.ts`、`tests/acceptance.test.ts`、`tests/refresh.test.ts`、`tests/helpers/stats-fixture.ts`

实施结果：新增 `ParsedStep` 并让 `ParsedRequest` 携带该请求全部 Step 事实；`mergeStep` 改为四项求和、按步时间戳调用 `isDeepseekOffpeak`、记录每步模型与来源标记，请求级模型取第一步标识、请求内出现多模型时置告警而不改变归属；`step_count` 等于 Step 条数；C3 / C4 改为校验请求级求和结果，`zeroTotalSteps` 仍按步计数；`total_tokens` 缺失 / 为 0 时的兜底抽为单一函数，Step 与请求行共用同一取值。请求级 `isDeepseekOffpeak` 按计划保留至 T002 删除。解析层单测由 7 个扩到 12 个，覆盖单步请求新旧一致、多步求和、上下文压缩回落、Σ 各步四项 = 请求四项、多模型告警且无按步分摊、09 / 12 / 14 / 18 边界、周末、节假日日历注入与跨零点长请求。

求和口径使 `stats-fixture` / `acceptance` / `refresh` 三处固定 fixture 的旧「取最大值」硬编码数值同时失效，本任务一并把它们改为求和后的确定性数值，并按新语义重写两条旧口径用例（「合计等于各步求和，不再按最大值截断」「80 步骤的长链路请求仍只计一个请求，token 按逐步求和」）；未放宽、跳过或删除任何既有断言。这四个测试文件原列在 T002 / T003 范围，此处提前修正数值，后续任务仍按各自目标继续补结构与比率用例。

验证：`npm run typecheck` 退出码 0；`npx vitest run tests/parse.test.ts` 12 passed；`npm test` 18 个文件 184 passed | 1 skipped（原 18 files / 179 passed | 1 skipped，净增解析层用例并修正数值）；`npm run build` 退出码 0（Vite 既有 chunk >500 kB 提示，非失败）。`npm run acceptance` 属 T004，依赖 T002 / T003 / T005，本任务不执行。

必要的问题与决策：

- 多模型告警落在解析层专用的 `FileParseWarnings.multiModelRequests`，不扩展 `ParseWarnings` / `RefreshResult.warnings`：Spec R9 要求 `/api/refresh` 响应形状不变，而 `WARNING_KEYS` 是刷新汇总的白名单。因此 T002 完成条件中的「`WARNING_KEYS` 同步 T001 扩展的告警键」不再需要执行，`WARNING_KEYS` 保持七个键不变；代价是多模型计数只在解析层可观测，实测数据 0 例，按 Spec「不处理请求内多模型」的范围可接受。
- `parseSourceFile` 新增可选 `calendar` 参数（默认 `CHINA_HOLIDAYS`），供解析层单测注入节假日表验证按步判档；`refresh.ts` 调用方式不变，不改变对外行为。判档纯函数的边界用例仍由 `tests/deepseek-offpeak.test.ts` 覆盖，未重复改写。
- 请求级四项 token 已是求和派生值，但数据库仍是 schema 4：未重扫的历史行保留旧值，按本任务「纯增量」定位不提供混合口径一致性，由 T002 递增版本删库重建统一。

提交：2dad131

# T002 数据库结构与写库切换

状态：done

目标与完成条件：按 Spec R2 / R8 / AC8 与 Plan AD-P1 / AD-P2 / AD-P5 把数据库与写库切到逐步口径。`SCHEMA_VERSION` 4 → 5，新增 `steps` 表（一行一次模型调用，含业务键 `request_id` / `source_file_id`、步骤序号、时间戳、四项 token、模型、来源标记、按步档位）与必要索引，删除 `requests.is_deepseek_offpeak` 列及 `ParsedRequest` 对应字段，并同步删除 `parse.ts` 中该字段的构造（`isDeepseekOffpeak` 函数仍保留供按步判档使用）；`refresh.ts` 在同一事务内写入请求行与全部 Step 行、C10 按 `source_file_id` 同事务双删 `requests` 与 `steps`、跨文件同值副本守卫改为按 `request_id` 只留一行并计入 `duplicateRequestIds` 告警且副本步骤不重复插入，`WARNING_KEYS` 同步 T001 扩展的告警键；`attachCredits` 仍按请求挂接 `credit_json`、与 steps 解耦。请求行四项 token 写求和派生值（AD-P1）。完成条件：结构列清单与版本号单测、「请求行四项 = Σ 该请求 steps 四项」、同文件二次解析与跨文件副本不重复计数（含 steps）、旧库启动自动删库重建、重建前后请求数一致且外部 `workbuddy.db` 及 `-wal` / `-shm` 的 size / mtime 不变（AC8）；与 T003 合并为同一原子提交并统一验证（见「执行顺序与依赖」）；`npm run typecheck` 通过。

必要依赖：T001

修改范围：`src/etl/database.ts`、`src/etl/refresh.ts`、`src/etl/parse.ts`、`src/etl/dimensions.ts`、`src/shared/types.ts`、`tests/database.test.ts`、`tests/refresh.test.ts`

实施结果：`SCHEMA_VERSION` 4 → 5；新增 `steps` 表（业务键 `request_id` / `source_file_id`、`step_index`、`timestamp`、`model`、`is_subagent`、`is_deepseek_offpeak` 与四项本步 token，`UNIQUE (request_id, step_index)`），删除 `requests.is_deepseek_offpeak` 列及 `ParsedRequest` / `parse.ts` 中对应字段构造，`isDeepseekOffpeak` 函数仍保留供按步判档。`refresh.ts` 同事务写入请求行与全部 Step 行、文件级事务与 `deleteSource` 均双删 `requests` / `steps`、`INSERT_REQUEST_SQL` 去掉「取更大 total_tokens」的旧条件与档位列；`attachCredits` 与 `WARNING_KEYS` 未改。`src/etl/dimensions.ts` 实际未改：该文件只管维表与 `source_files`，不含请求或步骤写入逻辑。

验证：`npm run typecheck` 退出码 0；`npm test` 18 个文件 189 passed | 1 skipped；`npm run build` 退出码 0。新增用例覆盖结构列清单与 `schema_version = 5`、请求行四项 = Σ 该请求 steps 四项、步骤逐条落库且序号 / 时间戳 / 档位 / 来源标记正确、整文件替换后步骤数收敛、跨文件副本步骤不重复、旧库启动自动删库重建且重建前后请求数一致与外部 `workbuddy.db` 及 `-wal` / `-shm` 的 size / mtime 不变（AC8）。与 T003 合并为同一原子提交并统一验证。

必要的问题与决策：

- 跨文件同值副本采用「替换」而非「跳过」：若发现 `request_id` 已属于其他文件，先在同一事务内删掉该请求的旧行与全部旧步骤，再写入当前文件的版本。若直接跳过，源文件被删除时该请求会整体消失（副本从未写库）；替换方案保持「最后写入者持有」，仍满足只留一行、计 `duplicateRequestIds` 告警、副本步骤不重复。
- `steps` 不另建 `request_id` 索引：`UNIQUE (request_id, step_index)` 的隐式索引已覆盖 `JOIN ... ON st.request_id = r.request_id`，只额外建 `idx_steps_source_file_id` 服务按文件双删。
- T002 完成条件中「`WARNING_KEYS` 同步 T001 扩展的告警键」不再执行：T001 已按 R9 把多模型告警限定在解析层 `FileParseWarnings`，刷新汇总仍是原七个键。

提交：a3efc9c

# T003 服务层比率重算

状态：done

目标与完成条件：按 Spec R4 / R5 / R6 / R7 / AC3 / AC4 与 Plan AD-P4 重写 `getTimeseries` 的比率聚合。分母以 `steps s JOIN requests r` 为源，`m.model IN (DEEPSEEK_MODEL_KEYS)` 过滤，按 `r.date_key + s.is_deepseek_offpeak` 分桶累加各步命中 / 未命中输入与输出后套 `officialCost` 两档相加；分子改为按请求独立聚合（请求级子查询按 `request_id` 汇总 `credit` 与 `date_key`），不得与分母共用 JOIN 结果而把 `credit` 放大成每步一份；复用 `wbCost` 与跨月单价；分母 0 → `null`、分子 0 → 0、只返回有 DS 请求的日期、无 DS 请求 `ratios` 为空数组等分支保持，`PriceRatioRow` / `TimeseriesResponse` 形状不变。四个主聚合 SQL、`buildWhere`、模型分组 / 分段 / 排序不动（AD-P1 / R9），日期归属仍按请求 `r.date_key`、档位按步骤。完成条件：比率单测覆盖分子不被多步 DS 请求放大、跨档长请求分别计价、分母 0 / 分子 0 / 跨月单价 / 无 DS 请求空数组、四个筛选生效（含非 DS 模型）、`rows` 结构与既有端点响应 `toEqual` 只有数值变化（AC5）；AC4 隐含单价在闲时组与高峰组接近；`npm run typecheck` 通过；与 T002 合并为同一原子提交并统一验证（见「执行顺序与依赖」）。

必要依赖：T002

修改范围：`server/query.ts`、`tests/price-ratio.test.ts`、`tests/api.test.ts`、`tests/acceptance.test.ts`

实施结果：`query.ts` 新增 `STEP_FROM`（`requests r JOIN steps st`，步骤别名避开 `BASE_FROM` 的 `sessions s`）；分母按 `(r.date_key, st.is_deepseek_offpeak)` 分桶累加各步命中输入 / 未命中输入 / 输出后套 `officialCost` 两档相加；分子改为独立请求级子查询（`BASE_FROM` 按 `date_key` 聚合 `SUM(r.credit)`），不与分母共用 JOIN，`credit` 不再被每步放大。两条查询共用同一 `ratioWhere` 与参数（四个筛选 + DS 白名单），`byDate` 合并结果；分母 0 → `null`、分子 0 → 0、只返回有 DS 请求的日期、无 DS 请求 `ratios` 为空数组等分支保留。四个主聚合 SQL、`buildWhere`、模型分组 / 分段 / 排序均未改（AD-P1 / R9）。

`tests/price-ratio.test.ts` 改为 `requests` + `steps` 双表 fixture，新增「多步 DS 请求不放大分子且跨档分别计价」「跨月各天用各自自然月单价」「四个筛选对分子分母同时生效、无 DS 请求返回空数组」「闲时组与高峰组比率自洽（AC4）」；跨 TZ 子进程脚本同步新结构。`tests/api.test.ts` / `tests/acceptance.test.ts` 的旧数值已在 T001 修正，本任务无需再改，四个端点响应形状由既有 `toEqual` 断言覆盖。

验证：`npm run typecheck` 退出码 0；`npx vitest run tests/price-ratio.test.ts` 8 passed；`npm test` 18 个文件 189 passed | 1 skipped；`npm run build` 退出码 0。与 T002 合并为同一原子提交并统一验证。

必要的问题与决策：

- 分子分母拆为两条独立查询但共用 `ratioWhere`，保证 R7「共用同一筛选范围」；`byDate` 取两者日期并集，DS 请求缺步骤时 `official = 0` → `ratio = null`，与「分母为 0 时 `null`」一致。
- 分母按桶求和后再调 `officialCost`：单步 C4 成立时 `Σcache ≤ Σinput`，与逐步分别计价等价，无需先把 `hit` / `miss` 落库。

提交：a3efc9c

# T004 e2e 固定样本与期望值扩展

状态：done

目标与完成条件：按 Spec AC1 / AC2 / AC3 / AC6 与 Plan「交互验收」把 e2e 固定样本从「每请求 1 步」扩展为含多步骤、跨 09:00 / 12:00 / 14:00 / 18:00 档位、DS 与非 DS 模型的样本，`tests/helpers/jsonl.ts` 同步支持逐步行；`tests/e2e/expectations.ts` 的推导函数改为与服务端同口径（按步求和、按步判档），期望值仍从样本确定性推出、不硬编码本机实测数字；样本只用 `message.usage` 四项 + `providerData`，不伪造 `rawUsage`；`sample.spec.ts` 自检同步；AC6 补「旧口径说明文案已移除」与 K / M / B 格式断言，AC9 既有回归项继续通过。完成条件：`npm run acceptance` 通过，或如实记录未执行原因。

必要依赖：T002、T003、T005

修改范围：`tests/e2e/`、`tests/helpers/jsonl.ts`、`scripts/e2e-fixture.mjs`

实施结果：`sample.ts` 新增 `SampleStep` / `sampleSteps()` 与 `SampleRequest.steps?`，`toLines` 改为每个请求输出多行 jsonl；`r-a2`（DS）拆成跨 09:00 / 12:00 / 14:00 / 18:00 六步、`r-a5`（非 DS）拆成三步、`r-a1`（11-10 DS）为逐步求和后真实放大的多步请求。`expectations.ts` 的请求级四项、输入 / 输出 / 缓存、按模型 / 分组 / 会话 / 日期拆分全部改为逐步骤求和，比率分母按每步 `isDeepseekOffpeak` 分档计价、分子仍按请求 `credit` 累加一次。`sample.spec.ts` 自检改为推导式并新增「请求级合计 = Σ 步骤且大于首步」；`trend.spec.ts` tooltip 柱行改为由 `dayRows` 推导；`metrics.spec.ts` 命中率自检不再写死百分比；`structure.spec.ts` 新增 AC6「旧口径说明已移除、界面无本次新增说明文字、Token 数值仍用 K/M/B」。`tests/helpers/jsonl.ts` 补充说明一条 `StepSpec` 即一步；`scripts/e2e-fixture.mjs` 无需改动，它只调用 `buildSampleHome`。

验证：`npm run typecheck` 退出码 0；`npm run acceptance` 40 passed（Node 24.19.0 置于 PATH 首位，Chromium 已就绪），包含 `focus.spec.ts` 12 个像素级 hover 用例与 `trend.spec.ts` 全部比率 tooltip 用例；`npm test` 在 T002 + T003 批次已通过且本任务只改 e2e 文件。

必要的问题与决策：

- 第一次尝试让默认三天区间内的多步请求真实放大，把 11-12 总量从 4.0K 抬到 4.25K，Y 轴量程随之由 4.0K 升到 5.0K，GLM 极窄色段不足 10 个纯色像素，`focus.spec.ts` 的 8 个像素级用例找不到取样点。用 `git stash` 回退样本后复验基线 12/12 通过，确认是样本量程问题而非实现错误。最终把 `r-a2` / `r-a5` 改成「拆步但请求级四项不变」，真实放大仅放在 11-10 的 `r-a1`（默认三天区间外）：首步小于求和值且跨档分布改变比率，仍完整验证求和口径与按步判档，同时不扰动既有像素级断言。
- `npm run acceptance` 必须让 Node 24 位于 PATH 首位（本机 `E:\Software\nodejs`）；WorkBuddy 托管的 Node 22.22.2 会被 `npm start` 的版本检查拒绝，单测与类型检查则两者都可运行。

提交：6f619e9

# T005 前端旧口径文案移除

状态：done

目标与完成条件：按 Spec「用户或系统行为」/ AC6 与 Plan AD-P6 移除界面旧口径说明。`ModuleSectionProps.description` 改为可选 `string`、组件仅在有值时渲染副标题 `<p>`，Token 模块不再传该 prop，积分模块仍传原值且渲染不变；不替换为任何口径说明、不新增界面元素与文案。图表配置、色表、tooltip 分流、`format.ts` 不动。完成条件：前端相关单测与 `npm run typecheck` 通过，交互验收断言界面无该说明文案且无本次新增说明文字。

修改范围：`src/web/App.tsx`、`src/web/components/ModuleSection.tsx`、`tests/`

实施结果：`ModuleSectionProps.description` 改为可选 `string`，组件仅在有值时渲染副标题 `<p>`；Token 模块不再传该 prop，积分模块仍传「按请求汇总的积分消耗。」且渲染不变。未新增任何说明文字、界面元素或图表配置改动。未改 `tests/`：交互验收中「旧口径说明文案已移除」的断言由 T004 补。

验证：`npm run typecheck` 退出码 0；`npm test` 18 个文件 189 passed | 1 skipped；`npm run build` 由 T002 + T003 批次已通过，本次仅改两个前端文件且类型检查通过。界面文案断言属 T004 的 `npm run acceptance`。

提交：cc6ee9d

# T006 跨时区与判档回归补强

状态：done

目标与完成条件：按 Spec AC7 与 Plan「跨时区」把逐步口径纳入回归。扩展 `tests/price-ratio.test.ts` 的既有用例，以至少两种 `TZ` 子进程比对同一组绝对时间戳下的 `date_key`、每步档位、比率序列与时间格式化结果一致，覆盖 UTC+8 零点与 09:00 / 12:00 / 14:00 / 18:00 峰谷边界；沿用固定 fixture，不依赖运行进程时区；`tests/timezone.test.ts` 的日期键与格式化用例按逐步档位同步，判档纯函数的边界用例仍由 `tests/deepseek-offpeak.test.ts` 覆盖、不重复改写。完成条件：`npm test` 中该跨 TZ 用例在多种 TZ 下均执行且通过，`npm run typecheck` 通过。

必要依赖：T001、T003

修改范围：`tests/price-ratio.test.ts`、`tests/timezone.test.ts`

实施结果：`timezone.test.ts` 的快照扩到 9 个步骤级绝对时间戳（UTC+8 零点，以及 08:59 / 09:00 / 11:59 / 12:00 / 13:59 / 14:00 / 17:59 / 18:00 峰谷边界），每个输出 `toDateKey`、`isDeepseekOffpeak`、`formatDateTime`，三种 TZ 全量比对同一份硬编码期望。`price-ratio.test.ts` 的 `ratiosInTimezone` 子进程改用同一组时间戳写 `requests` / `steps`，且 `date_key` 与 `is_deepseek_offpeak` 在子进程内由 `toDateKey` / `isDeepseekOffpeak` 派生，输出 `dateKeys` / `offpeakFlags` / `formatted` / `rows` / `ratios` 的 JSON，UTC、Asia/Shanghai、America/Los_Angeles 三种 TZ 做字符串全量相等比对，另保留跨月请求覆盖自然月单价。`tests/deepseek-offpeak.test.ts` 未改，判档纯函数的边界仍由它独占覆盖。

验证：`npm run typecheck` 退出码 0；`npx vitest run tests/timezone.test.ts tests/price-ratio.test.ts tests/deepseek-offpeak.test.ts` 14 passed；`npm test` 18 个文件 189 passed | 1 skipped。

必要的问题与决策：

- 跨 TZ 子进程不写死日期键与档位列值，而是按绝对时间戳现算：一旦 `toDateKey` 或 `isDeepseekOffpeak` 意外读机器时区，`dateKeys` / `offpeakFlags` / `ratios` 会随 TZ 漂移，用例立即失败，而不是只在结果一致时侥幸通过。
- 两份用例共用同一组边界时间戳语义（北京时间 11-12 零点与峰谷边界），`timezone.test.ts` 负责日期键与格式化，`price-ratio.test.ts` 负责档位与比率序列，不重复改写 `deepseek-offpeak.test.ts`。

提交：06bc313

# T007 长期文档同步

状态：done

目标与完成条件：按 Spec「与既有交付的关系」/ AC10、Plan AD-P5.5 与 AGENTS.md 第 5 节，在实现稳定后一次性同步六份长期文档：`product-brief.md`（关键术语「累计用量」→ 逐步语义）、`technical-architecture.md`（AD-2，及「五张表 + 一张配置表」「测试分层里五个端点」两处表述）、`data-model.md`（Step 实体落库、C2 / C3 / C4、请求级 `is_deepseek_offpeak` 列处置、关系图、`schema_version` 4 → 5）、`integration.md`（逐步用量特性、字段实测对应、各类 credit 数据源粒度与统计口径边界）、`deepseek-pricing.md`（分母逐步分档、摊销费用命名、节假日表维护改为步骤级）、`devops.md`（交互验收覆盖、删索引重建、节假日表更新）。`integration.md` 除「累计用量特性」整节、字段表「累计值」标注与「实测 40 倍，绝不求和」外，还须清除事件类型表 `function_call` 行、兼容性风险表「`usage` 语义变化 / 累计值非单调」两行、实测快照段「累计值回退」与「按请求取最大值合计 / 逐条累加约 39.8 倍」等旧口径表述；`technical-architecture.md`「测试分层里五个端点」按四个数据读取端点 + `/api/health` + `/api/refresh` 的实际路由改写。`docs/delivery/v1.0.0/` 归档与已完成交付文档不改写。完成条件：文档与代码无已知矛盾，旧口径说明已清除，节假日维护说明按 Plan「取舍确认记录」的 AD-P2 定案（判档落库）书写。

必要依赖：T001、T002、T003、T004、T005、T006

修改范围：`docs/`

实施结果：六份长期文档一次性同步，逐份要点如下。

- `product-brief.md`：关键术语「累计用量」改为「逐步用量」，明确 `message.usage` 四项是本步值、请求级四项为逐步求和、上下文压缩回落前后的调用都计入；「步骤」补明是独立计费的用量事实，「请求」补明模型归属取第一步。核心问题、业务目标、非目标与成功标准未动。
- `technical-architecture.md`：模块划分表补齐逐步事实产出、两张事实表与「四个筛选端点只读 `requests` 派生列，只有比率分母 JOIN `steps`」；「五张表 + 一张配置表」改为「六张表 + 一张配置表（两张事实表）」；测试分层按四个数据读取端点 + `/api/health` + `/api/refresh` 改写；刷新数据流补同事务替换请求行与步骤行，`/api/timeseries` 说明补分母按步分档、分子请求级独立聚合；**AD-2 整段重写**为 Step / Request 双粒度并存，并说明四个主聚合 SQL 不 JOIN `steps` 的理由；数据量段补 `steps` 行数说明。AD-1、AD-3–AD-8 保持有效。
- `data-model.md`：Step 实体从「解析期归并后丢弃」改为落 `steps`（主键 `id`、业务键 `(request_id, step_index)`），新增 `steps` 表小节含全部列与索引说明；`requests` 删除 `is_deepseek_offpeak` 列、四项 token 说明改为 Σ 对应步骤的派生列、`started_at` 说明补「档位不再由其派生」；关系图补 `steps` 并写明用业务键而非内部 `id` 关联的原因；C2 改逐步求和与请求级模型取第一步、C3 / C4 校验对象改求和结果、C8 / C10 改同事务双删双写且跨文件副本改为替换语义；生命周期第 3 / 5 / 7 步同步；版本管理写明当前 5 与 4 → 5 的变更内容，节假日表更新改为「历史步骤」重判。C1、C5–C7、C9、C11–C14 未改。
- `integration.md`：事件类型表 `message` / `function_call` 改「本步用量」；字段表四项去掉累计标注并补 `rawUsage.credit` / `original_credit` 两行及「不进入统计口径」；「累计用量特性」整节改写为「逐步用量特性」，保留 8 次调用的示例并写明同源同粒度但统计用途不同、逐步 credit 不入口径、档位按该条自己的时间戳；`credit_json` 描述改为「请求级总量，不是某一条记录的值」；「积分数据形态」开头改为各类 credit 数据源列举 + 唯一真源声明，逐条积分 / 独立事件 / 请求级积分三节各补「口径边界」；兼容性风险表两行替换为四行（语义变化、上下文压缩回落、请求内多模型、步骤与请求行不一致）；实测快照段「累计值回退」「按请求取最大值合计 / 39.8 倍」两行改写，跨文件重复按 C1 引用、恒等校验补逐步求和后按请求校验。
- `deepseek-pricing.md`：分子统一称「摊销费用」并说明不是实付；分母改为按每步时间戳判档、分桶套价目表，日期归属仍按请求 `date_key`；补分子分母必须独立聚合（分子不与步骤 JOIN）的说明；敏感性段改为「逐步求和后比率基线已低于 1，假设被推翻时只会进一步下降、方向不再反转」；节假日表维护改为 `steps.is_deepseek_offpeak` 落库、递增 `SCHEMA_VERSION` 让全部历史步骤按新表重判（按 AD-P2 定案 A）。
- `devops.md`：首次刷新说明改为「同事务写入请求行与逐步事实行，全量重建为秒级」，不再写死旧口径下的实测秒数；交互验收新增「多步骤样本」条目；「解析规则变更」补递增 `SCHEMA_VERSION`（当前 5）与双删重写；「节假日表更新」改为步骤级判定。

验证：六份文档的旧口径关键词（`累计用量` / `累计值` / `取最大值` / `绝不求和` / `时间末条` / `39.8` / `40 倍` / `五张表` / `五个端点` / `只落一行` / `归并后丢弃`）扫描无残留；相对链接 15 条全部有效；与代码对照 `SCHEMA_VERSION = 5`、七张表（含 `meta`）、`steps` 列清单与 `idx_steps_source_file_id` 一致、四个主聚合 SQL 未 JOIN `steps`；`npm run typecheck` 退出码 0；`git status` 显示 `docs/delivery/` 与 `docs/delivery/v1.0.0/` 无改动，归档与已完成交付文档未被改写。

必要的问题与决策：

- `integration.md` 实测快照保留 `6,757,760,362` / `169,950,303` 两个本机数字，但措辞改为「逐步求和才是真实消耗、每个请求只保留一条记录会漏计」，删去旧倍数结论。它们是标注「仅作量级校验，不作断言」的历史量级快照，不是测试断言；Spec AC1 禁止写死本机数字作为断言的要求仍由 fixture / 样本确定性推导满足。
- `docs/backlog/subagent-credit-reconciliation.md:13` 的「不是取最大值或末条」描述的是 `credit_json` 的积分累加语义，与 token 口径无关，本次也未改积分口径。该条目 2026-11-13 已结案，按 Spec「已完成交付文档不改写」保留原文，在 T008 的 backlog 检查中记录结论，不因关键词扫描而回改历史记录。
- AD-2 保留原编号整段重写，避免改动其它段落对其的交叉引用；`data-model.md` C2 同样保留编号，只反转约束内容，C1 / C5–C14 的引用关系不变。

提交：93cb1eb

# T008 交付收尾检查

状态：done

目标与完成条件：按 AGENTS.md 第 5 节与 Spec AC1–AC10 逐项收尾：核对验收标准全部满足、各任务状态与实施记录准确完整、各已实施任务的「提交」字段已回填对应 commit hash、全量执行 `npm run typecheck` / `npm test` / `npm run build` / `npm run acceptance` 并如实记录结果与未执行原因（类型检查为独立必需项，不能被 lint / build / 测试代替）、六份长期文档与实际实现一致、`docs/backlog/` 与本次交付相关条目已检查、旧交付文档未被改写；记录重建耗时与已知限制（请求内多模型、团队子代理积分、子代理积分缺口）。完成后做收尾提交，收尾任务本身不填「提交」字段。

必要依赖：T001、T002、T003、T004、T005、T006、T007

修改范围：`docs/delivery/step-level-usage-tasks.md`、`docs/`

实施结果：按 Spec AC1–AC10 与 AGENTS.md 第 5 节逐项核对，全部满足。

- **AC1 口径基线**：`tests/parse.test.ts` 的 `expectStepSum` 与 `tests/refresh.test.ts`「请求行四项 = Σ 该请求 steps 四项」覆盖固定 fixture 手算；单步请求新旧一致有独立用例。本机全量复核（160 文件 / 510 请求 / 10,504 步）：`SUM(requests.total_tokens)` 与 `SUM(steps.total_tokens)` 严格相等，均为 1,998,395,497；DS 257 请求 / 1,378,097,136 token。Spec 快照 1,845.6M / 1,302.5M 随原始数据增长而上升，按 AC1「基线随原始数据变化时按同口径重算」处理，未写死为断言常量。
- **AC2 约束**：逐步求和后 C3 / C4 仍成立（本机 `input 1,988,376,501 + output 10,018,996 = total 1,998,395,497`；`cache 1,950,440,064 ≤ input`）；`step_count` 等于步骤行数、跨文件副本不重复计数、多模型 fixture 断言请求级模型取第一步且无按步分摊，均由 T001 / T002 单测覆盖。
- **AC3 比率数值**：`tests/price-ratio.test.ts` 8 个用例覆盖分子 / 分母 / 比率手算、跨月单价、分母 0 → `null`、分子 0 → 0、四个筛选与无 DS 请求空数组；本机全区间 `ΣwbCost / ΣofficialCost = 13.2924 / 65.2319 = 0.2038`，与 Spec AC3 的 0.203× 一致，20 个有 DS 请求的日期均产出比率、无 `null` 点。按步判档与按请求判档的差异由 AC4 用例覆盖。
- **AC4 交叉验证**：`price-ratio.test.ts`「按步分档计价后闲时组与高峰组比率自洽」用例通过；本机加权比率落在同一量级，旧口径 4.16× 的不自洽结果不再出现。
- **AC5 结构兼容**：`tests/api.test.ts` 既有 `toEqual` 全量通过，四个数据读取端点字段 / 顺序 / 粒度与 `rows` / `ratios` 形状不变；`WARNING_KEYS` 仍为七键，`/api/refresh` 与 `/api/health` 响应未变。
- **AC6 前端**：`structure.spec.ts` 断言 Token 模块无副标题、界面无新口径说明且放大后数值仍用 K / M / B；`metrics.spec.ts`、`trend.spec.ts` 覆盖格式、比率折线、非 DS 筛选隐藏与积分 tab 不变。
- **AC7 时间无关性**：`timezone.test.ts` 与 `price-ratio.test.ts` 跨 TZ 子进程在 UTC、Asia/Shanghai、America/Los_Angeles 三种 `TZ` 下，对 `dateKeys` / `offpeakFlags` / `formatted` / `rows` / `ratios` 做字符串全量相等比对通过。
- **AC8 重建**：`tests/database.test.ts` / `refresh.test.ts` 断言 `schema_version = 5`、旧库启动自动删库重建、重建前后请求数一致、外部 `workbuddy.db` 与 `-wal` / `-shm` 的 size / mtime 不变。本机全量重建两次实测 2,669 ms 与 2,567 ms（`RefreshResult.durationMs` 2,660 ms），160 个文件零失败、零解析告警。
- **AC9 回归**：`npm run acceptance` 40 passed 含 filters / breakdown / focus / tooltip / 分组归一化 / 颜色绑定等既有浏览器回归；`npm test` 189 passed | 1 skipped。
- **AC10 检查与文档**：四项命令全通过；六份长期文档与代码一致；`docs/delivery/v1.0.0/` 归档与已完成交付文档未被改写。

各任务状态均为 `done`，T001–T007 的「提交」字段已回填（T001 `2dad131`；T002 / T003 `a3efc9c` 同一原子提交；T005 `cc6ee9d`；T004 `6f619e9`；T006 `06bc313`；T007 `93cb1eb`），T008 按约定不填「提交」字段。`docs/backlog/` 两项已检查：`subagent-credit-reconciliation.md`（2026-11-13 已结案）描述的是 `credit_json` 积分累加，与 token 口径无关且本次未改积分口径，无矛盾，按 T007 记录的决策保留原文；`panel-acceptance-segment-width.md` 的「段宽累计舍入」是几何累加，与用量口径无关。两项均无需改写，本次未产生新 backlog 条目。`git diff --stat 7427327..HEAD -- docs/` 显示本交付只新增 Spec / Plan / Tasks 三份交付文档并修订六份长期文档，归档与 `deepseek-price-ratio-*` / `time-range-group-split-*` / `hover-model-focus-*` 等已完成交付文档无改动。

重建耗时：本机 160 个 jsonl（约 187MB 量级）全量重建约 2.6–2.7 秒，产出 510 请求行、约 10,500 条步骤行、90 个分组，零失败零告警；`steps` 落库后仍在秒级，不引入新依赖与缓存层。测量使用临时 `DATABASE_PATH=.data/rebuild-benchmark.db`，完成后已清理，外部 `~/.workbuddy` 全程只读、未写、未搬移、未备份。

已知限制（沿用既有口径，本次不扩大范围）：

- 请求内多模型：实测 0 例；请求级模型取第一步标识，解析层 `FileParseWarnings.multiModelRequests` 记录告警但不进入 `/api/refresh` 响应、不按步分摊、不展示多模型。
- 团队子代理积分：并入父请求 `credit_json`，本地没有独立键，不能按子请求拆分统计。
- 子代理积分缺口：`custom_agent` 等独立子代理在官方计量接口按独立 `requestId` 计费，本地为 0（31 天实测 4 条 / 10.20 分）；不追溯补齐、不估算，也不接入官方接口。
- 缓存等价性假设：本地 `cache_read` 视作 DeepSeek 官方上下文缓存命中，未独立验证；敏感性说明见 `docs/deepseek-pricing.md`。
- 同名自定义模型与原生模型按同一 `model` 标识合并（原始日志无来源字段）。

验证：`npm run typecheck` 退出码 0（独立必需项，未被 lint / build / 测试替代）；`npm test` 18 个文件 189 passed | 1 skipped（190）；`npm run build` 退出码 0（Vite 既有 chunk >500 kB 提示，非失败）；`npm run acceptance` 40 passed（35.2s，Node 24.19.0 置于 PATH 首位，Chromium 已就绪）。四项均通过，无未执行项、无跳过用例、无放宽断言。

必要的问题与决策：

- AC1 / AC3 的 Spec 本机快照数字（1,845.6M / 1,302.5M、0.203×）是 2026-11-14 的原始数据基线。收尾复核时原始数据仍在增长，实测 1,998.4M / 1,378.1M；加权比率 0.2038× 仍与 0.203× 一致。按 Spec「基线随原始数据变化时按同口径重算，不得直接写死为断言常量」，未把它们写入测试，仅记录同口径复核结果。
- 重建耗时用真实全库 + 临时派生库测量，而不是 e2e 固定样本：样本只有 5 天跨度，不能代表全量重扫成本。临时库用后即删，不改日常实例 `.data/database.db`。
