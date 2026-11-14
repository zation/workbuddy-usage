# 开发与运维

<!-- 只写操作方式，不写具体密钥、口令或环境变量的值。 -->

## 环境准备

- **Node.js ≥ 24**（项目约定）。本机为 v24.19.0，位于 `E:\Software\nodejs`。
  注意：PATH 首位是 WorkBuddy 托管的 v22.22.2（`~/.workbuddy/binaries/node/versions/`）。实测 22.22.2 也能直接加载 `node:sqlite`（22.13.0 起已取消 `--experimental-sqlite`），但会打印 `ExperimentalWarning`；项目仍要求 24，理由见 [technical-architecture.md](./technical-architecture.md)。若终端里 `node -v` 显示 22，用绝对路径调用，或把系统 Node 目录调到 PATH 前面。
- 首次拉取后安装依赖：`npm install`。
- 日常检查：`npm run typecheck`（独立类型检查）、`npm test`（Vitest）、`npm run build`（服务端 tsc + 前端 Vite）。项目未配置 lint（无 ESLint / Prettier 依赖），因此没有 lint 检查项。
- 沙箱内曾出现 vitest 5.1.0 无法建立 runner 上下文（`Cannot read properties of undefined (reading 'config')`，最小探针即可复现，与项目代码、Node 版本、pool 模式、Vite 缓存和 `NODE_OPTIONS` 均无关），当时以开发者本地 `npm test` 输出作为正式回归证据；该环境差异已消失，当前环境可直接执行 `npm test`。若再次出现，仍按「本地补跑 + 沙箱等价断言」处理，不得删除测试或放宽标准。
- 无需数据库服务、无需 Docker、无需 Python。

## 密钥与配置

本项目不含任何密钥，也不访问网络。

可选配置项直接以环境变量提供（服务不会自动加载 `.env.local`，写入该文件不生效）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WORKBUDDY_HOME` | `~/.workbuddy` | WorkBuddy 数据根目录；指向样本目录可用于验证解析口径 |
| `DATABASE_PATH` | `.data/database.db` | 本项目数据库文件路径；指向临时文件可隔离验收与日常实例 |
| `PORT` | `4620` | 面板监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |

路径类配置会由 `resolve()` 转成绝对路径，相对值以服务进程的工作目录为基准。

**不要改为 `0.0.0.0`。** 面板暴露的是本机完整对话用量记录，仅限回环访问；服务启动时校验 `HOST`，非回环地址会直接退出。

切换 `WORKBUDDY_HOME` 后先删除本项目数据库再启动，或改用 `DATABASE_PATH` 指向另一个数据库文件。数据库以绝对路径记录来源，直接切换会让旧路径被判为"文件已不存在"而清理对应请求。

## 部署

本项目为本地单机工具，不需要服务端部署。

首次运行：

1. `npm install`
2. 开发用 `npm run dev`（Vite `5173` 热更新 + API `4620`），日常使用用 `npm run build && npm start`（单端口）
3. 开发打开 `http://127.0.0.1:5173`；生产打开 `http://127.0.0.1:4620`

dev 的 Vite proxy 只转发 `^/api/` 前缀。不要改回 `/api`：前端模块 `src/web/api.ts` 的请求路径以 `/api` 开头，会被一并转发到服务端并返回 HTML，导致整页白屏。

首次启动会先执行一次刷新：全量解析全部 `*.jsonl`（265 个文件、约 444MB，实测约 2.4 秒；快照见 [integration.md](./integration.md)），之后按文件 mtime 与大小增量更新，通常 1 秒内完成；面板中的「刷新数据」触发同一流程。服务在首次刷新完成后才开始监听端口，刷新失败时仍会启动并保留原数据库，可在面板中手动重试。

WorkBuddy 数据库为 WAL 模式，只读连接依赖同目录的 `-wal` / `-shm`；WorkBuddy 运行时二者存在，实测只读查询不会改动这三个文件。

端口被占用时改 `PORT` 环境变量重启即可；不需要结束占用进程。

## 交互验收

交互验收由 Playwright 驱动，一条命令完成样本准备、构建、服务启停、用例执行与清理：

```bash
npx playwright install chromium   # 首次安装或升级 @playwright/test 后执行一次
npm run acceptance
```

- **Node 24 必须在 PATH 首位**：`webServer` 用 `npm start` 起服务，服务自身校验 Node ≥ 24。若 `node -v` 显示 22（本机 PATH 首位是 WorkBuddy 托管的 22.22.2），先把系统 Node 目录前置，例如 `export PATH="/e/Software/nodejs:$PATH"`，否则服务直接退出、用例报启动超时。
- **浏览器二进制**：默认 CDN 在本机不可达时改用镜像 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright npx playwright install chromium`。二进制装在用户目录，不入库。
- **执行顺序固定**为「生成样本 → `npm run build` → `playwright test` → 清理」，由 `scripts/e2e-run.mjs` 编排，不可颠倒：样本必须在服务启动前写好（否则首次刷新会读到空库），构建必须在服务启动前完成（否则前后端版本错配，趋势图空白）。
- **样本与端口**：临时 `WORKBUDDY_HOME` 为 `.data/e2e/home`（`workbuddy.db` + `projects/**/*.jsonl`，由 `scripts/e2e-fixture.mjs` 每次重建），本项目数据库用 `DATABASE_PATH=.data/e2e/database.db` 建在同一目录；服务固定监听 4630，`reuseExistingServer: false`，不会连到日常实例（4620）。
- **只读与可复现**：用例只读页面与 `/api`，不写、不搬移真实 `~/.workbuddy`；浏览器时间用 Playwright Clock 冻结在样本基准日（2026-11-14 12:00），日期与时间区断言不随运行日漂移。
- **产物**：运行结束由入口脚本删除 `.data/e2e/`；失败时 trace 与截图留在 `.data/e2e-results/`，用 `npx playwright show-trace <trace 文件>` 查看。
- **用例分工**：`structure.spec.ts`（网络与页面结构）、`filters.spec.ts`（筛选与时间区）、`metrics.spec.ts`（数值、单位、配色）、`trend.spec.ts`（趋势图与 tooltip）、`breakdown.spec.ts`（分组条与浮层）、`focus.spec.ts`（hover 聚焦 AC1–AC7）、`sample.spec.ts`（样本自检）、`panel.spec.ts`（首屏 smoke）。定位器集中在 `tests/e2e/panel-page.ts`，期望值由 `tests/e2e/sample.ts` 与 `tests/e2e/expectations.ts` 从样本确定性推出，不从 `/api` 现场反推。
- **不替代单元测试**：纯函数、格式化与图表配置的数值正确性仍由 `npm test`（Vitest）覆盖；`npm run acceptance` 只断言浏览器里可见的结果。

调试单个用例用 `npm run acceptance tests/e2e/focus.spec.ts`，追加 `--grep <用例名>` 可只跑一条；参数会透传给 `playwright test`。用例依赖的 `data-testid` 不存在——定位器统一用语义类名与 ARIA 角色，改动 DOM 结构时同步 `tests/e2e/panel-page.ts`。

`/api/timeseries` 不返回 `days`（日期轴由面板层按区间补），若 `npm run dev` 时前后端不是同一次构建，会出现趋势图空白；重启 dev 或重新 `npm run build` 即可，不能只回退一侧。

## 回滚

- **数据口径异常**：删除数据库文件（默认 `.data/database.db`）后重启，数据库会从原始数据全量重建。数据库可删可重建，删除无数据风险。
- **解析规则变更**：改动字段映射或归并逻辑后，同样删除数据库重建，避免旧口径的缓存结果残留。
- **节假日表更新**：`src/shared/china-holidays.ts` 补充或修改已公布的中国法定节假日安排后，会改变历史请求的 `is_deepseek_offpeak` 判定；递增 `SCHEMA_VERSION` 让旧数据库在下次启动自动删库重建即可，无需手工删除。不得录入未公布的放假安排。
- **版本回退**：`git revert` 或切换到上一个提交后，重新 `npm install` 并删库重建即可，无外部状态需要清理。
- **原始数据损坏或缺失**：不是本项目的问题范围。本项目不备份 `~/.workbuddy`，也不应尝试修复其中的文件。
