# vitest runner 上下文在当前执行环境未初始化

## 背景

执行 `deepseek-price-ratio` 交付的 T001 时，`npm test`（vitest 5.1.0 / vite 8.3.8）的 12 个测试文件全部在收集阶段失败，报 `TypeError: Cannot read properties of undefined (reading 'config')` 或 `Vitest failed to find the current suite`，没有测试用例被执行。

## 问题

- 最小探针（只 `import { describe, it, expect } from 'vitest'`，不导入任何项目代码）即可复现，因此与项目代码、测试内容、`vitest.config.ts` 和本次改动均无关。
- 已排除的可能原因：Node 22.22.2 与 Node 24.19.0、`--pool=threads`、`--no-isolate`、单 fork 模式、清理 `node_modules/.vite` 缓存、清空环境注入的 `NODE_OPTIONS`、用极简 JS 配置替代 `vitest.config.ts`，故障均不变。
- `npm ls` 无缺失的必需依赖；`npm run typecheck`（覆盖 `tests`）与 `npm run build` 均通过，说明源码与测试文件本身类型正确、可构建。
- 历史交付文档记录过 `npx vitest run tests/shared.test.ts` 通过，故判断是当前沙箱运行时的环境问题，而非仓库缺陷。

## 影响与已知约束

本次交付新增与修改的 vitest 单测无法在**当前沙箱**执行；开发者本地终端用同一套依赖与测试文件运行 `npm test` 全部通过（13 个测试文件、137 passed / 1 skipped，含新增的 `tests/timezone.test.ts`），说明故障仅限沙箱运行时，不是仓库缺陷，也不需要重装依赖。不得通过删除测试、跳过断言或放宽标准来规避沙箱故障。

## 结论与后续

- 交付的正式回归证据以开发者本地 `npm test` / `npm run acceptance` 输出为准；沙箱内每个任务另跑 `npm run typecheck`、`npm run build` 与 Node 24 直接导入 `.ts` 的等价断言。
- 本条目仅保留环境差异的事实与排查记录，不作为待实施事项；若后续沙箱环境变化导致测试恢复，直接按标准流程跑 `npm test` 即可，无需改动仓库。
- 已排除的排查项保留在上文，避免将来重复排查。
