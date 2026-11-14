// 验收样本准备：每次运行先清空 .data/e2e/，再重建临时 WORKBUDDY_HOME。
// 顺序要求：必须在服务进程启动之前完成，否则首次刷新会读到空样本。
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const FIXTURE_ROOT = resolve('.data/e2e');
const HOME_ROOT = resolve(FIXTURE_ROOT, 'home');

async function main() {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await mkdir(HOME_ROOT, { recursive: true });
  console.log(`样本目录就绪：${HOME_ROOT}`);
}

main().catch((error) => {
  console.error(`样本准备失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
