本 Tasks 对应 [deepseek-price-ratio-spec.md](./deepseek-price-ratio-spec.md)（Spec，`627a181` 固化）与 [deepseek-price-ratio-plan.md](./deepseek-price-ratio-plan.md)（Plan，`c5ae696` 固化）。任务编号稳定，不表示必须严格串行；实施时按 AGENTS.md 第 4 节逐个完成、逐个验证、逐个提交。

## 执行顺序与依赖

- **T001 必须最先完成**：闲时判定（T002）与 `date_key` 共用同一套 UTC+8 折算，ETL 派生列（T004）依赖两者同时就绪；若先写闲时列再改时间口径，按天比率会与日期归属错位。这是 Plan「实施顺序约束」里的正确性要求。
- T002 依赖 T001；T003 无强类型依赖，但按 Plan 顺序在 T001 之后实施（共用 UTC 纯日期算术口径）。
- T004 依赖 T001、T002；T005 依赖 T003、T004；T006 依赖 T005；T007 依赖 T006。
- T001 覆盖全链路时间折算（含消费方与测试 fixture）作为一个原子提交，避免中间态出现「shared 已改、前端仍读机器时区」的语义不一致。
- 长期文档按各任务的影响范围同步，不集中堆到收尾：T001 改 AD-6 与 `date_key` 说明，T003 改 `product-brief.md` 并新建价格规则文档，T004 改新列与版本说明，T005 改接口表，T007 改 `devops.md`。
- T008 为收尾任务，依赖 T001–T007；按 AGENTS.md 不填「提交」字段。各已实施任务的 commit hash 在收尾检查通过后统一回填，随收尾提交纳入。
- 任务提交正文须带 `Tasks-Doc: deepseek-price-ratio-tasks.md` 与对应 `Tasks: T00x`；Spec / Plan 的文档确认提交不带这两个字段。

# T001 时间口径统一

状态：done

目标与完成条件：按 Spec R1 与 Plan AD-P1 建立单一业务时区常量，把「时间戳 → 业务日期 / 显示时间」的折算全部改为固定 UTC+8，日期键算术改为 UTC 纯日期运算，时间戳字段继续以 epoch ms 存储与流转。覆盖 shared 纯函数、前端「今天」与两个时间格式化函数、验收脚本 `today()`、测试 fixture 的绝对时间戳构造。`formatDateKey` 只保留纯 UTC 日期键语义供日期算术使用，`todayKey()` 改走 `toDateKey(Date.now())`（否则会取到 UTC 日期、北京时间 00:00–08:00 显示前一天）；验收脚本保持不 import `.ts`，在脚本内实现同一 +8 折算。完成条件：至少 UTC / UTC+8 / UTC-8 三种环境下同一 epoch 得到相同的 `date_key`、`todayKey` 与显示结果（跨时区用子进程隔离验证）；现有日期单测改绝对构造后通过；`npm run typecheck` 通过。同步修订 AD-6 与 `data-model.md` 的 `date_key` 列说明、保留理由、C5。

修改范围：`src/shared/constants.ts`、`src/shared/dates.ts`、`src/web/filters.ts`、`src/web/format.ts`、`scripts/panel-acceptance.mjs`、`tests/`、`docs/technical-architecture.md`、`docs/data-model.md`

实施结果：`constants.ts` 新增 `BUSINESS_TZ_OFFSET_MS`；`dates.ts` 的 `toDateKey` 改为 UTC+8 折算（唯一「绝对时间 → 业务日期」入口），`formatDateKey` 改为纯 UTC 日期键语义，`parseDateKey` / `addDays` / `isValidDateKey` 改 UTC 日期算术，`daySpan` 与 `enumerateDays` 不变；`filters.ts` 的 `todayKey(nowMs?)` 改走 `toDateKey` 并支持注入时间；`format.ts` 两个格式化函数改用 `getUTC*` 加固定偏移；验收脚本 `todayKey()` 在脚本内自带 +8 折算，保持不 import `.ts`。测试 fixture 全部改 `Date.UTC` 绝对构造，`parse.test.ts` 跨零点 helper 用减偏移量保持「北京 23:50 → 次日 00:10」语义，新增 `tests/timezone.test.ts` 用三种 TZ 的子进程比对同一快照。AD-6、`data-model.md` 的 `date_key` 列说明、保留理由与 C5 同步改写。

验证：`npm run typecheck` 通过（0 错；tsconfig 的 include 覆盖 `tests`，新增与修改的测试文件类型均通过）；`npm run build` 通过（621 模块，dist 产物正常）；Node 24 直接导入 `.ts` 执行 18 条纯函数断言全部通过，并以 `UTC` / `Asia/Shanghai` / `America/Los_Angeles` 三个子进程比对 `toDateKey` / `todayKey` / `formatDateTime` / `formatRefreshTime`，输出一致。**开发者本地终端 `npm test`：13 个测试文件全部通过，137 passed / 1 skipped（输出由开发者提供，含本任务新增的 `tests/timezone.test.ts`），作为正式回归证据。** 当前沙箱内 vitest 5.1.0 无法建立 runner 上下文（最小探针可复现，与改动无关，已排除 Node 版本、pool 模式、isolate、Vite 缓存、注入的 `NODE_OPTIONS` 与项目配置），详见 `docs/backlog/vitest-runner-context.md`。

必要的问题与决策：沙箱内 `npm test` 故障为执行环境特有问题，开发者本地用同一套依赖与测试文件全部通过，判定不需要改动依赖、也不需要降低校验标准；沙箱内保留等价断言作为功能正确性证据，正式回归以开发者本地 `npm test` 结果为准。

提交：

# T002 闲时判定与节假日表

状态：done

目标与完成条件：按 Spec R2 / R7 与 Plan AD-P2 新建闲时判定纯函数与法定节假日集合。判定按 `started_at`、与 `date_key` 共用 UTC+8 折算；规则为北京时间工作日且非法定节假日的 09:00–12:00、14:00–18:00 为高峰，其余空闲。完成条件：边界单测覆盖 09:00 / 11:59 / 12:00 / 14:00 / 17:59 / 18:00、周末、节假日、UTC 跨日，断言与官方中英文页一致；节假日表只录已公布安排，并显式给出已覆盖年份清单（判定函数只在覆盖年份内查表，空集合不等于「该年无节假日」），未覆盖年份按周一至周五判定；`npm run typecheck` 通过。

必要依赖：T001

修改范围：`src/shared/deepseek-offpeak.ts`（新）、`src/shared/china-holidays.ts`（新）、`tests/`

实施结果：新建 `china-holidays.ts`，用 `HolidayCalendar { coveredYears, holidays }` 表达「已核对年份」与「节假日日期集合」，默认日历为空集合且显式标注无覆盖年份；空集合不表示「该年无节假日」。新建 `deepseek-offpeak.ts` 的 `isDeepseekOffpeak(startedAt, calendar?)`，与 `date_key` 共用 UTC+8 折算，周末直接判空闲，已覆盖年份内的节假日全天空闲，工作日按 09:00–12:00 / 14:00–18:00 左闭右开判高峰，边界 12:00 与 18:00 归入空闲。日历可注入，使「节假日生效」与「未覆盖年份不查表」都能测。新增 `tests/deepseek-offpeak.test.ts` 五组用例。

验证：`npm run typecheck` 通过（0 错）；Node 24 直接导入 `.ts` 执行 17 条等价断言全部通过，覆盖高峰区间两端、四个边界时刻、周末、UTC 跨日、已覆盖年份节假日与未覆盖年份。沙箱内 `npm test` 仍受既有 runner 故障影响，正式回归以开发者本地 `npm test` 为准（见 `docs/backlog/vitest-runner-context.md`）。

必要的问题与决策：Plan 写的是 `isDeepseekOffpeak(startedAt, holidays)`，实现改为可注入的 `HolidayCalendar`（把 `coveredYears` 与 `holidays` 打包），避免「空集合」与「未覆盖年份」两种语义散在两个参数里；ETL 调用仍用默认日历，接口行为不变。

提交：

# T003 价格表与比率纯函数

状态：pending

目标与完成条件：按 Spec R3 / R4 / R5 / R6 与 Plan AD-P3 建立模型白名单、三档价目表、套餐参数、`creditUnitPrice(dateKey)` 与 `officialCost(...)`；月天数用 UTC 日期算术求得，覆盖 28 / 29 / 30 / 31 天与跨月，不写死固定单价。完成条件：纯函数单测断言大小月单价不同、跨月各取各自月份、分子为 0 与分母为 0 的行为符合 Spec 边界表；新建价格规则文档记录价目表版本与来源、模型映射、套餐参数、缓存等价性假设及敏感性、节假日表维护方式；改写 `product-brief.md` 的非目标条目（`:41` 保持不变，按 Plan 判断）；`npm run typecheck` 通过。

修改范围：`src/shared/deepseek-pricing.ts`（新）、`tests/`、`docs/deepseek-pricing.md`（新）、`docs/product-brief.md`

# T004 ETL 派生列与派生库结构

状态：pending

目标与完成条件：按 Spec R2 / AC3 与 Plan AD-P2 把闲时标记接入 `ParsedRequest` 并在刷新时写入 `requests.is_deepseek_offpeak`，`SCHEMA_VERSION` 3→4；`ON CONFLICT DO UPDATE` 分支同步该列。完成条件：旧库自动删库重建后每行都有 0/1，`date_key` 与闲时标记由同一 `started_at` 派生；在原始日志未变化的前提下，重建前后当前 GMT+8 环境的按天合计一致（AC1）；相关 ETL 单测与 `npm run typecheck` 通过；`data-model.md` 同步新列说明、「节假日表更新需递增版本」的维护约束与版本号。

必要依赖：T001、T002

修改范围：`src/shared/types.ts`、`src/etl/parse.ts`、`src/etl/refresh.ts`、`src/etl/index-db.ts`、`tests/`、`docs/data-model.md`

# T005 服务层比率聚合与 API 契约

状态：pending

目标与完成条件：按 Spec R5 / AC4 与 Plan AD-P4 在 `getTimeseries` 增加按天 × 闲时的第二条聚合，复用 `buildWhere(filters)` 并追加 DS 白名单，产出顶层 `ratios`；`rows` 的形状与语义不变，其余端点不变。完成条件：`ratios` 的分子 / 分母 / 比率与手算 fixture 逐请求对账一致；同一天同时含高峰与空闲请求时，分子只由当天 credit 总和乘一次单价（不按档重复计入），分母为两档官方费用之和；分母为 0 时 `ratio: null`、分子为 0 时比率如实为 0；服务层只返回有 DS 请求的日期、不补空白日期；四个筛选对 `ratios` 生效，筛选非 DS 模型时返回空数组；补一条跨时区断言覆盖 AC1 的「比率序列一致」；类型契约单测、API 单测与 `npm run typecheck` 通过；`technical-architecture.md` 接口表同步。

必要依赖：T003、T004

修改范围：`src/shared/types.ts`、`server/query.ts`、`tests/api.test.ts`、`docs/technical-architecture.md`

# T006 前端折线、双 Y 轴与 tooltip 分流

状态：pending

目标与完成条件：按 Spec「用户或系统行为」/ AC5 与 Plan AD-P5 在 Token 趋势图增加一条按天比率折线：注册 `LineChart`、`yAxis` 改数组（右轴 `×`）、柱显式 `yAxisIndex: 0`、折线 `yAxisIndex: 1`、折线不进 `legend`、缺失日期 `null` 且 `connectNulls: false`；按 `seriesId` 分流 tooltip 格式，比率单独一行带 `×`，不参与柱子的 0 值过滤与降序排序。完成条件：积分图与既有柱状行为（0 值隐藏、排序、转义、色表）完全不变；筛选非 DS 模型时折线隐藏且界面无新增文案；相关前端单测与 `npm run typecheck` 通过。

必要依赖：T005

修改范围：`src/web/components/EChart.tsx`、`src/web/components/TrendChart.tsx`、`src/web/App.tsx`、`tests/`

# T007 交互验收断言与 devops 同步

状态：pending

目标与完成条件：按 Spec AC5 / AC6 与 Plan「测试策略」在验收脚本补第二 Y 轴、单条折线、`null` 断线、非 DS 筛选隐藏且无提示文案、tooltip 比率带 `×` 的断言；既有验收项全部继续通过；`devops.md` 同步验收覆盖范围与「节假日表更新需重建索引」的操作说明。完成条件：`npm run acceptance` 通过；若本地服务或验收环境不可用，记录未执行原因并补跑等价的前端单测。

必要依赖：T006

修改范围：`scripts/panel-acceptance.mjs`、`docs/devops.md`

# T008 交付收尾检查

状态：pending

目标与完成条件：按 AGENTS.md 第 5 节逐项确认：Spec 的 AC1–AC7 全部满足；各任务状态、实施结果与验证记录准确完整；各已实施任务的「提交」字段已回填对应 commit hash；`npm run typecheck`、`npm test`、`npm run build`、`npm run acceptance` 通过或未执行项已清楚记录原因；长期文档（`product-brief.md`、`technical-architecture.md`、`data-model.md`、`devops.md`、`deepseek-pricing.md`）与代码无已知矛盾；backlog 中与本次交付相关的条目已检查。完成后做收尾提交，收尾任务本身不填「提交」字段。

必要依赖：T001、T002、T003、T004、T005、T006、T007

修改范围：`docs/delivery/deepseek-price-ratio-tasks.md`、`docs/`
