# vitest runner 上下文在当前执行环境未初始化

## 背景

执行 `deepseek-price-ratio` 交付的 T001 时，`npm test`（vitest 5.1.0 / vite 8.3.8）的 12 个测试文件全部在收集阶段失败，报 `TypeError: Cannot read properties of undefined (reading 'config')` 或 `Vitest failed to find the current suite`，没有测试用例被执行。

## 问题

- 最小探针（只 `import { describe, it, expect } from 'vitest'`，不导入任何项目代码）即可复现，因此与项目代码、测试内容、`vitest.config.ts` 和本次改动均无关。
- 已排除的可能原因：Node 22.22.2 与 Node 24.19.0、`--pool=threads`、`--no-isolate`、单 fork 模式、清理 `node_modules/.vite` 缓存、清空环境注入的 `NODE_OPTIONS`、用极简 JS 配置替代 `vitest.config.ts`，故障均不变。
- `npm ls` 无缺失的必需依赖；`npm run typecheck`（覆盖 `tests`）与 `npm run build` 均通过，说明源码与测试文件本身类型正确、可构建。
- 历史交付文档记录过 `npx vitest run tests/shared.test.ts` 通过，故判断是当前沙箱运行时的环境问题，而非仓库缺陷。

## 影响与已知约束

本次交付新增与修改的 vitest 单测无法在当前沙箱执行。功能正确性已用 Node 24 直接导入 `.ts` 的等价断言与三时区子进程快照验证，但「`npm test` 全绿」这一验收项缺少证据，需在开发者本地终端补跑确认。不得通过删除测试、跳过断言或放宽标准来规避。

## 预期价值与待确认问题

恢复 `npm test` 可让后续任务与收尾检查重新具备完整回归证据。待确认：

- 是否允许尝试 `npm ci` 重装依赖（只改 `node_modules`，需要网络，有清空依赖的风险）或调整 vitest 版本。
- 若环境暂不可修，验收是否接受「typecheck + build + 等价断言」加「开发者本地补跑 `npm test`」作为替代证据。
