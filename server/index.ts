import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { resolveEtlConfig } from '../src/etl/config.ts';
import { openIndex } from '../src/etl/index-db.ts';
import { createRefresher } from '../src/etl/refresh.ts';

const REQUIRED_NODE_MAJOR = 24;
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

if (Number.isNaN(nodeMajor) || nodeMajor < REQUIRED_NODE_MAJOR) {
  console.error(
    `需要 Node.js >= ${REQUIRED_NODE_MAJOR}（当前 ${process.versions.node}）。` +
      '项目依赖 node:sqlite 的稳定行为，请改用 Node 24 及以上版本。',
  );
  process.exit(1);
}

const app = new Hono();
const config = resolveEtlConfig();
const index = openIndex(config.indexPath);

console.log(`派生索引就绪：${config.indexPath}${index.rebuilt ? '（已重建）' : ''}`);

try {
  const result = await createRefresher(index.db, config).refresh();
  console.log(
    `首次刷新完成：扫描 ${result.scannedFiles} 个文件，变更 ${result.changedFiles} 个，` +
      `写入 ${result.upsertedRequests} 条请求，耗时 ${result.durationMs}ms`,
  );
} catch (error) {
  console.error('首次刷新失败，索引保持原状，可在面板中手动重试。', error);
}

app.get('/api/health', (c) => c.json({ ok: true }));

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4620', 10);

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`API 监听 http://${host}:${info.port}`);
});
