# 开发与运维

<!-- 只写操作方式，不写具体密钥、口令或环境变量的值。 -->

## 环境准备

- **Node.js ≥ 24**（项目约定）。本机为 v24.19.0，位于 `E:\Software\nodejs`。
  注意：PATH 首位是 WorkBuddy 托管的 v22.22.2（`~/.workbuddy/binaries/node/versions/`）。实测 22.22.2 也能直接加载 `node:sqlite`（22.13.0 起已取消 `--experimental-sqlite`），但会打印 `ExperimentalWarning`；项目仍要求 24，理由见 [technical-architecture.md](./technical-architecture.md)。若终端里 `node -v` 显示 22，用绝对路径调用，或把系统 Node 目录调到 PATH 前面。
- 首次拉取后安装依赖：`npm install`。
- 日常检查：`npm run typecheck`（独立类型检查）、`npm test`（Vitest）、`npm run build`（服务端 tsc + 前端 Vite）。项目未配置 lint（无 ESLint / Prettier 依赖），因此没有 lint 检查项。
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

<!-- 本节仍描述旧 CDP 脚本，将在 hover-model-focus 交付中改为 Playwright 后重写，勿据此操作。 -->

交互类验收用 `scripts/panel-acceptance.mjs`：脚本通过 CDP 驱动本机 Chrome，核对 tab 与 ARIA 关联（含非激活面板 `hidden` 与 canvas 数）、筛选两入口一致、拆分列表行数与滚动、明细折叠与懒加载、token 单位、缓存命中率、0 值隐藏与模型下拉可切换。时间区核对四个快捷按钮与「更多」展开的起止框的双向联动、默认与重置为近 3 天、非法区间的错误提示与清空回弹、面板层补轴（近 7 天画满 7 格）、100 天可用与 101 天被前端和 API 一致拦截；分组列表核对按模型分段的段色与段宽之和、hover 与键盘 focus 的明细提示。趋势图部分从页面已加载的 ECharts 实例读取 y 轴刻度、tooltip、x 轴类目与 series 颜色，另核对单位无「万 / 亿」/ 积分 `k` 与配色跨筛选稳定。趋势图部分另核对 Token 图的价格比率折线（第二 Y 轴 `×`、单条折线、`null` 断线、不进图例、tooltip 按 `seriesId` 分流；区间内无 DS 数据时整条隐藏且不提示）。逐项打印 PASS/FAIL，失败时退出码为 1。

脚本取「全量区间」的方式是 `GET /api/timeseries`（不带日期参数）返回 `rows` 里的最早 `date` 到当天，所以**数据跨度不能超过 100 天**。当前样本约 47 天；若本机数据增长到超过 100 天，脚本会在建立宽区间前直接报错。此时把依赖全量区间的断言改为直接读取不带日期参数的 API，或临时用 `WORKBUDDY_HOME` 指向样本目录后重建数据库再跑。

自定义日期框由「更多」按钮展开，收起态仍留在 DOM（`hidden`）中，脚本的 `.date-range input[type=date]` 取数与赋值入口不变；脚本断言的是筛选状态，不依赖展开动作。

无头 Chrome 默认被判为未聚焦，脚本会开启 `Emulation.setFocusEmulationEnabled`，否则用 `focus()` 触发的浮层断言不会生效。

`/api/timeseries` 已不再返回 `days`（日期轴由面板层生成）。若 API 与前端不是同一次构建（开发期前后端版本错配），会出现趋势图空白；重启 `npm run dev` 或重新 `npm run build` 即可，前后端需同次构建，不能只回退一侧。

1. 用 Node 24 启动面板：`npm run dev`
2. 另开一个带调试端口的 Chrome（示例为 macOS 路径，其它系统换成自己的 Chrome 可执行文件）：

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox \
     --remote-debugging-port=9222 --user-data-dir=/tmp/wb-acceptance about:blank
   ```

3. 运行 `npm run acceptance`

可用 `BASE_URL`（默认 `http://127.0.0.1:5173/`）与 `CDP_PORT`（默认 `9222`）指向其它实例，设置 `SCREENSHOT_DIR` 会额外保存一张面板截图。脚本只读页面与 `/api`，不改动数据；依赖 Node 内置 WebSocket，不引入新依赖。

## 回滚

- **数据口径异常**：删除数据库文件（默认 `.data/database.db`）后重启，数据库会从原始数据全量重建。数据库可删可重建，删除无数据风险。
- **解析规则变更**：改动字段映射或归并逻辑后，同样删除数据库重建，避免旧口径的缓存结果残留。
- **节假日表更新**：`src/shared/china-holidays.ts` 补充或修改已公布的中国法定节假日安排后，会改变历史请求的 `is_deepseek_offpeak` 判定；递增 `SCHEMA_VERSION` 让旧数据库在下次启动自动删库重建即可，无需手工删除。不得录入未公布的放假安排。
- **版本回退**：`git revert` 或切换到上一个提交后，重新 `npm install` 并删库重建即可，无外部状态需要清理。
- **原始数据损坏或缺失**：不是本项目的问题范围。本项目不备份 `~/.workbuddy`，也不应尝试修复其中的文件。
