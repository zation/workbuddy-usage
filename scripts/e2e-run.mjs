// 交互验收运行入口：固定「生成样本 → 构建 → 执行用例 → 清理」的顺序，顺序不可颠倒。
// 清理不能放进 Playwright 的 globalTeardown：它在回收 webServer 之前执行，服务仍持有临时
// 数据库，Windows 下删除被占用文件会失败；由本进程在 playwright 退出后统一清理。
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const PLAYWRIGHT_CLI = resolve('node_modules/@playwright/test/cli.js');

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} 被信号终止（${signal}）`));
      } else if (code !== 0) {
        reject(new Error(`${command} 退出码 ${code}`));
      } else {
        resolvePromise();
      }
    });
  });
}

async function build() {
  // 由 npm run acceptance 启动时 npm_execpath 指向 npm-cli.js，避免依赖 shell 与 .cmd
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    await run(process.execPath, [npmCli, 'run', 'build']);
    return;
  }
  await run('npm', ['run', 'build']);
}

async function main() {
  const passthrough = process.argv.slice(2);
  try {
    await run(process.execPath, ['scripts/e2e-fixture.mjs']);
    await build();
    await run(process.execPath, [PLAYWRIGHT_CLI, 'test', ...passthrough]);
  } finally {
    await rm(resolve('.data/e2e'), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`验收未通过：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
