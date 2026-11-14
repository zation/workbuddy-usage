import { defineConfig } from '@playwright/test';

/** 验收专用端口，避开日常面板的 4620，避免连到正在使用的实例。 */
const ACCEPTANCE_PORT = 4630;
const BASE_URL = `http://127.0.0.1:${ACCEPTANCE_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  // 只收集 .spec.ts：Vitest 的单测用 .test.ts，两边靠后缀隔离
  testMatch: '**/*.spec.ts',
  // 全部用例共享同一份样本、同一个服务实例与同一份筛选状态，串行执行避免竞态
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  outputDir: '.data/e2e-results',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1400, height: 1100 },
    // 与 canvas 像素断言绑定：1 个 CSS 像素对应 1 个 canvas 像素
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // 构建由 npm run acceptance 前置完成，这里只负责起停与回收
    command: 'npm start',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(ACCEPTANCE_PORT),
      HOST: '127.0.0.1',
      // 样本与临时数据库同目录，避免读写日常实例；样本由 scripts/e2e-fixture.mjs 在启动前写入
      WORKBUDDY_HOME: '.data/e2e/home',
      DATABASE_PATH: '.data/e2e/database.db',
    },
  },
});
