# 开发与运维

<!-- 只写操作方式，不写具体密钥、口令或环境变量的值。 -->

## 环境准备

- **Node.js ≥ 24**（项目约定）。本机通过 nvm 安装 v24.21.0，位于 `~/.nvm/versions/node/v24.21.0/bin`。
  注意：PATH 首位是 WorkBuddy 托管的 v22.22.2（`~/.workbuddy/binaries/node/versions/`）。实测 22.22.2 也能直接加载 `node:sqlite`（22.13.0 起已取消 `--experimental-sqlite`），但会打印 `ExperimentalWarning`；项目仍要求 24，理由见 [technical-architecture.md](./technical-architecture.md)。若终端里 `node -v` 显示 22，用绝对路径调用，或把系统 Node 目录调到 PATH 前面。
- 首次拉取后安装依赖：`npm install`。
- 日常检查：`npm run typecheck`（独立类型检查）、`npm test`（Vitest）、`npm run build`（服务端 tsc + 前端 Vite）。项目未配置 lint（无 ESLint / Prettier 依赖），因此没有 lint 检查项。
- 无需数据库服务、无需 Docker、无需 Python。

## 密钥与配置

本项目不含任何密钥，也不访问网络。

可选配置项，写入 `.env.local`（已在 `.gitignore` 中，不入库），或直接以环境变量提供：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WORKBUDDY_HOME` | `~/.workbuddy` | WorkBuddy 数据根目录；指向样本目录可用于验证解析口径 |
| `PORT` | `4620` | 面板监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |

**不要改为 `0.0.0.0`。** 面板暴露的是本机完整对话用量记录，仅限回环访问；服务启动时校验 `HOST`，非回环地址会直接退出。

切换 `WORKBUDDY_HOME` 后先删除 `.data/index.db` 再启动。索引以绝对路径记录来源，直接切换会让旧路径被判为"文件已不存在"而清理对应请求。

## 部署

本项目为本地单机工具，不需要服务端部署。

首次运行：

1. `npm install`
2. 开发用 `npm run dev`（Vite `5173` 热更新 + API `4620`），日常使用用 `npm run build && npm start`（单端口）
3. 开发打开 `http://127.0.0.1:5173`；生产打开 `http://127.0.0.1:4620`

dev 的 Vite proxy 只转发 `^/api/` 前缀。不要改回 `/api`：前端模块 `src/web/api.ts` 的请求路径以 `/api` 开头，会被一并转发到服务端并返回 HTML，导致整页白屏。

首次启动会先执行一次刷新：全量解析全部 `*.jsonl`（265 个文件、约 444MB，实测约 2.4 秒；快照见 [integration.md](./integration.md)），之后按文件 mtime 与大小增量更新，通常 1 秒内完成；面板中的「刷新数据」触发同一流程。服务在首次刷新完成后才开始监听端口，刷新失败时仍会启动并保留原索引，可在面板中手动重试。

外部库为 WAL 模式，只读连接依赖同目录的 `-wal` / `-shm`；WorkBuddy 运行时二者存在，实测只读查询不会改动这三个文件。

端口被占用时改 `PORT` 环境变量重启即可；不需要结束占用进程。

## 回滚

- **数据口径异常**：删除 `.data/index.db` 后重启，索引会从原始数据全量重建。索引是纯派生物，删除无数据风险。
- **解析规则变更**：改动字段映射或归并逻辑后，同样删除索引重建，避免旧口径的缓存结果残留。
- **版本回退**：`git revert` 或切换到上一个提交后，重新 `npm install` 并删索引重建即可，无外部状态需要清理。
- **原始数据损坏或缺失**：不是本项目的问题范围。本项目不备份 `~/.workbuddy`，也不应尝试修复其中的文件。
