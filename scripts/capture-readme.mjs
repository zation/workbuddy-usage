#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { chromium } from '@playwright/test';
import { createApp } from '../server/app.ts';

const GROUP_NAMES = [
  'alpha', 'beta', 'gamma', 'docs', 'scripts', 'web', 'api', 'tools',
  'infra', 'lab', 'studio', 'core', 'playground', 'notes', 'sandbox', 'draft',
];
const SESSION_NAMES = [
  '接口重构', '数据校验', '方案评审', '回归排查', '文档整理', '临时问答',
  '脚本清理', '需求梳理', '配置调整', '代码审阅', '联调验证', '性能优化',
  '用例补充', '日志分析', '样式打磨', '发布检查',
];
const SHOTS = ['overview.png', 'filters.png', 'trend.png', 'credit.png', 'requests.png'];
const FROZEN_CLOCK = 'T23:30:00+08:00';
const PLACEHOLDERS = new Set([
  ...GROUP_NAMES, ...SESSION_NAMES, '默认', '未知分组', '未知会话',
  'WorkBuddy', 'workbuddy', '.workbuddy', 'Users', 'users', 'projects',
  'Documents', 'Desktop', 'Library', 'Application Support',
]);

function usage() {
  return `用法：node scripts/capture-readme.mjs <源 database.db> [--out 目录] [--hover-date YYYY-MM-DD]

  --out        输出目录，默认 assets/screenshots
  --hover-date 两张趋势图 hover 的日期，默认取最近 7 天内积分最高的一天（不含最后一天）
`;
}

function parseArgs(argv) {
  const positional = [];
  const options = { out: 'assets/screenshots', hoverDate: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      options.out = argv[++index];
    } else if (arg === '--hover-date') {
      options.hoverDate = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith('--')) {
      throw new Error(`未知参数 ${arg}\n${usage()}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error(usage());
  }
  return { source: resolve(positional[0]), ...options };
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function addDays(dateKey, delta) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function labelFrom(pool, index) {
  return index < pool.length ? pool[index] : `project-${pad(index + 1)}`;
}

function sessionLabel(index) {
  return `${SESSION_NAMES[index % SESSION_NAMES.length]} ${pad(Math.floor(index / SESSION_NAMES.length) + 1)}`;
}

/** 按用量降序给业务键排位，让拆分表里出现的是短名字而不是大编号。 */
function usageRank(db, column) {
  const rows = db
    .prepare(
      `SELECT ${column} AS id, COALESCE(SUM(total_tokens), 0) AS total
         FROM requests WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY total DESC`,
    )
    .all();
  return new Map(rows.map((row, index) => [row.id, index]));
}

/** 只取 JSON 的字符串值：字段名 outputTokens 之类不应被当作名称泄漏。 */
function collectStringValues(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStringValues(item, output);
    }
  }
  return output;
}

/** 只保留可能泄露真实信息的片段：过短、纯占位词都跳过。 */
function collectSecrets(rows) {
  const fragments = new Set();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value !== 'string' || value.length < 4 || PLACEHOLDERS.has(value)) {
        continue;
      }
      fragments.add(value);
      for (const part of value.split(/[\\/]/)) {
        if (part.length >= 4 && !PLACEHOLDERS.has(part)) {
          fragments.add(part);
        }
      }
    }
  }
  return [...fragments];
}

function anonymize(source, target, frozenMs) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  const db = new DatabaseSync(target);

  const groups = db.prepare('SELECT id, group_path, display_name FROM groups ORDER BY id').all();
  const sessions = db
    .prepare('SELECT id, session_key, custom_title, title, display_name FROM sessions ORDER BY id')
    .all();
  const files = db.prepare('SELECT id, session_key, sub_session_key, path FROM source_files').all();

  const secrets = collectSecrets([...groups, ...sessions, ...files]);
  const groupRank = usageRank(db, 'group_id');
  const sessionRank = usageRank(db, 'session_id');
  const sessionKeys = new Map();

  const groupUpdate = db.prepare('UPDATE groups SET group_path = ?, display_name = ? WHERE id = ?');
  let groupFallback = groupRank.size;
  groups.forEach((group) => {
    const rank = groupRank.has(group.id) ? groupRank.get(group.id) : groupFallback++;
    const name = labelFrom(GROUP_NAMES, rank);
    groupUpdate.run(name, name, group.id);
  });

  const sessionUpdate = db.prepare(
    'UPDATE sessions SET session_key = ?, custom_title = ?, title = ?, display_name = ? WHERE id = ?',
  );
  let sessionFallback = sessionRank.size;
  sessions.forEach((session, index) => {
    const key = `session-${pad(index + 1, 3)}`;
    const rank = sessionRank.has(session.id) ? sessionRank.get(session.id) : sessionFallback++;
    const name = sessionLabel(rank);
    sessionKeys.set(session.session_key, key);
    sessionUpdate.run(key, name, name, name, session.id);
  });

  const fileUpdate = db.prepare(
    'UPDATE source_files SET path = ?, session_key = ?, sub_session_key = NULL WHERE id = ?',
  );
  files.forEach((file) => {
    fileUpdate.run(
      `session-${pad(file.id, 4)}.jsonl`,
      sessionKeys.get(file.session_key) ?? `legacy-${file.id}`,
      file.id,
    );
  });

  db.prepare('UPDATE meta SET last_refresh_at = ?, last_full_scan_at = ? WHERE id = 1').run(
    frozenMs - 3 * 60_000,
    frozenMs - 60 * 60_000,
  );

  const stats = db
    .prepare(
      `SELECT MIN(date_key) AS firstDay, MAX(date_key) AS lastDay,
              COUNT(*) AS requests, COALESCE(SUM(credit), 0) AS credit,
              COALESCE(SUM(total_tokens), 0) AS tokens
         FROM requests`,
    )
    .get();
  const daily = db
    .prepare(
      `SELECT date_key AS day, COALESCE(SUM(credit), 0) AS credit,
              COALESCE(SUM(total_tokens), 0) AS tokens
         FROM requests GROUP BY date_key ORDER BY date_key`,
    )
    .all();
  const schema = db.prepare('SELECT schema_version AS version FROM meta WHERE id = 1').get();

  db.close();
  return { secrets, stats, daily, schema, groups: groups.length, sessions: sessions.length };
}

function pickHoverDay(daily, lastDay, explicit) {
  if (explicit) {
    return explicit;
  }
  const candidates = daily.filter(
    (row) => row.day <= addDays(lastDay, -1) && row.day >= addDays(lastDay, -7),
  );
  const withCredit = candidates.filter((row) => row.credit > 0);
  const pool = withCredit.length > 0 ? withCredit : candidates;
  if (pool.length === 0) {
    return addDays(lastDay, -1);
  }
  return pool.reduce((best, row) => (row.credit > best.credit ? row : best)).day;
}

/** 复制自验收页面对象：用 x 轴线颜色反推绘图区左右边界，按类目均分定位。 */
async function axisBounds(chart) {
  return chart.locator('canvas').first().evaluate((node) => {
    const canvas = node;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    const { width, height } = canvas;
    const top = Math.floor(height / 2);
    const rows = height - top;
    const data = context.getImageData(0, top, width, rows).data;
    let left = Number.POSITIVE_INFINITY;
    let right = -1;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (
          data[index] === 230 && data[index + 1] === 232 &&
          data[index + 2] === 235 && data[index + 3] === 255
        ) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    const ratio = canvas.getBoundingClientRect().width / width;
    return right - left > 100 ? { left: left * ratio, right: right * ratio } : null;
  });
}

async function hoverDay(page, index, count, expectedDate) {
  const chart = page.locator('.chart').first();
  const box = await chart.locator('canvas').first().boundingBox();
  if (!box) {
    throw new Error('趋势图没有 canvas');
  }
  let bounds = null;
  for (let attempt = 0; attempt < 30 && !bounds; attempt += 1) {
    bounds = await axisBounds(chart);
    if (!bounds) {
      await page.waitForTimeout(100);
    }
  }
  if (!bounds) {
    throw new Error('趋势图尚未完成绘制');
  }
  const step = (bounds.right - bounds.left) / count;
  const x = box.x + bounds.left + (index + 0.5) * step;
  const y = box.y + box.height * 0.78;
  await page.mouse.move(2, 2);
  await page.mouse.move(x, y);
  await page.waitForTimeout(120);
  await page.mouse.move(x, y);
  await page.waitForFunction(
    (date) => document.querySelector('.trend-tooltip')?.textContent?.includes(date) ?? false,
    expectedDate,
    { timeout: 5000 },
  );
  await page.waitForTimeout(1200);
}

/** ECharts 的 setOption 会重启动画；连续两次 canvas 采样一致才算绘制完成。 */
async function waitForChartStable(page) {
  const canvas = page.locator('.chart').first().locator('canvas').first();
  let previous = '';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const current = await canvas.evaluate((node) => {
      const context = node.getContext('2d');
      if (!context) {
        return '';
      }
      const data = context.getImageData(0, 0, node.width, node.height).data;
      let sum = 0;
      for (let index = 0; index < data.length; index += 997) {
        sum = (sum * 31 + data[index]) >>> 0;
      }
      return String(sum);
    });
    if (current && current === previous) {
      return;
    }
    previous = current;
    await page.waitForTimeout(200);
  }
  throw new Error('趋势图动画未在预期时间内稳定');
}

async function waitForData(page) {
  await page.waitForFunction(() => {
    const node = document.querySelector('.metric-card .metric-value');
    return Boolean(node && node.textContent && node.textContent.trim() !== '—');
  });
  await page.waitForSelector('.chart canvas');
  await page.waitForTimeout(1200);
}

async function clipShot(page, path, clip) {
  await page.screenshot({ path, clip, animations: 'disabled' });
}

async function main() {
  const { source, out, hoverDate } = parseArgs(process.argv.slice(2));
  if (!existsSync(source)) {
    throw new Error(`源数据库不存在：${source}`);
  }
  const staticRoot = resolve('dist/web');
  if (!existsSync(resolve(staticRoot, 'index.html'))) {
    throw new Error('缺少 dist/web/index.html，请先执行 npm run build');
  }
  mkdirSync(out, { recursive: true });

  const probe = new DatabaseSync(source, { readOnly: true });
  const probeStats = probe
    .prepare('SELECT MIN(date_key) AS firstDay, MAX(date_key) AS lastDay FROM requests')
    .get();
  probe.close();
  if (!probeStats?.lastDay) {
    throw new Error('源数据库没有任何请求数据');
  }
  const lastDay = probeStats.lastDay;
  const frozenMs = Date.parse(`${lastDay}${FROZEN_CLOCK}`);
  const from = addDays(lastDay, -29);
  const clockOffsetMs = frozenMs - Date.now();

  const copy = resolve('tmp/readme/database.db');
  const info = anonymize(source, copy, frozenMs);
  const targetDay = pickHoverDay(info.daily, lastDay, hoverDate);
  const hoverIndex = daysBetween(from, targetDay);
  if (hoverIndex < 0 || hoverIndex > 29) {
    throw new Error(`hover 日期 ${targetDay} 不在 30 天窗口 ${from} ~ ${lastDay} 内`);
  }

  console.log(`数据源：${source}`);
  console.log(`schema_version=${info.schema?.version} 请求数=${info.stats.requests} 日期=${info.stats.firstDay} ~ ${info.stats.lastDay}`);
  console.log(`30 天窗口：${from} ~ ${lastDay}；hover：${targetDay}（第 ${hoverIndex + 1} 天）`);
  console.log(`页面时间偏移：${Math.round(clockOffsetMs / 60_000)} 分钟（Date.now 持续推进，不冻结动画）`);
  console.log(`脱敏：${info.groups} 个分组、${info.sessions} 个会话，待检敏感片段 ${info.secrets.length} 条`);

  const db = new DatabaseSync(copy, { readOnly: true });
  const app = createApp({ db, staticRoot });
  let resolvePort;
  const portReady = new Promise((resolvePromise) => {
    resolvePort = resolvePromise;
  });
  const server = serve(
    { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
    (listener) => resolvePort(listener.port),
  );
  const port = await portReady;
  const base = `http://127.0.0.1:${port}`;
  console.log(`截图服务：${base}（不含刷新器，只读脱敏副本）`);

  const browser = await chromium.launch({ args: ['--lang=zh-CN'] });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    // 给 Date.now 加一个持续推进的偏移，让前端算出的「今天」等于数据末日；
    // 固定时间会让 ECharts 的入场动画停在中间帧，因此不能用 clock.setFixedTime。
    await page.addInitScript((offset) => {
      const nativeNow = Date.now.bind(Date);
      Date.now = () => nativeNow() + offset;
    }, clockOffsetMs);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitForData(page);

    const rangeResponse = page.waitForResponse(
      (response) => response.url().includes('/api/timeseries') && response.status() === 200,
    );
    await page.locator('[data-quick=thirtyDays]').click();
    await rangeResponse;
    await page.waitForTimeout(1000);

    await page.mouse.move(2, 2);
    await page.screenshot({
      path: resolve(out, 'overview.png'),
      fullPage: true,
      animations: 'disabled',
    });

    await page.locator('[data-more]').click();
    await page.locator('#filter-model').click();
    await page.waitForTimeout(250);
    const filterBox = await page.locator('.filter-bar').boundingBox();
    if (!filterBox) {
      throw new Error('筛选栏没有渲染');
    }
    await clipShot(page, resolve(out, 'filters.png'), {
      x: 0, y: Math.max(0, filterBox.y - 10), width: 1440, height: 470,
    });
    await page.mouse.click(700, 20);
    await page.locator('[data-more]').click();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(200);

    await hoverDay(page, hoverIndex, 30, targetDay);
    await waitForChartStable(page);
    // 元素截图会滚动节点并触发 ECharts 重绘，改用页面裁切保持 hover 时的绘制状态。
    const trendBox = await page.locator('.trend-panel').first().boundingBox();
    if (!trendBox) {
      throw new Error('趋势面板没有渲染');
    }
    await clipShot(page, resolve(out, 'trend.png'), {
      x: trendBox.x, y: trendBox.y, width: trendBox.width, height: trendBox.height,
    });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);

    await page.locator('#credit-tab').click();
    await page.waitForSelector('#credit-module .chart canvas');
    await page.waitForTimeout(1200);
    await hoverDay(page, hoverIndex, 30, targetDay);
    await waitForChartStable(page);
    await clipShot(page, resolve(out, 'credit.png'), {
      x: 0, y: 0, width: 1440, height: 830,
    });
    await page.mouse.move(2, 2);

    await page.locator('#token-tab').click();
    await page.locator('#token-module .table-toggle').click();
    await page.waitForSelector('#token-module table');
    // 当天请求的积分记账可能晚到，按时间降序会让积分列整列为 0；按积分降序截图既能
    // 展示真实消耗，也顺带展示表头排序。
    const sortedResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/requests') &&
        response.url().includes('sort=credit') &&
        response.status() === 200,
    );
    await page.locator('#token-module .sort-button').filter({ hasText: '积分' }).click();
    await sortedResponse;
    await page.waitForTimeout(500);
    await page
      .locator('#token-module .table-panel')
      .screenshot({ path: resolve(out, 'requests.png'), animations: 'disabled' });

    const bodyText = await page.evaluate(() => document.body.innerText);
    const query = `from=${from}&to=${lastDay}`;
    const endpoints = [
      `/api/summary?${query}`,
      `/api/timeseries?${query}`,
      `/api/breakdown?${query}&dim=group&split=model`,
      `/api/breakdown?${query}&dim=session`,
      `/api/breakdown?${query}&dim=model`,
      `/api/requests?${query}`,
      `/api/breakdown?dim=group`,
      `/api/breakdown?dim=session`,
    ];
    const apiBodies = await Promise.all(
      endpoints.map((path) => fetch(`${base}${path}`).then((response) => response.text())),
    );
    const apiValues = [];
    for (const body of apiBodies) {
      try {
        collectStringValues(JSON.parse(body), apiValues);
      } catch {
        apiValues.push(body);
      }
    }
    const scannedText = `${bodyText}\n${apiValues.join('\n')}`;
    const leaks = info.secrets.filter((secret) => scannedText.includes(secret));
    console.log(`脱敏自检：${leaks.length === 0 ? '通过' : `发现 ${leaks.length} 处残留`}`);
    if (leaks.length > 0) {
      console.error(leaks.slice(0, 10));
      throw new Error('页面或 API 仍含真实分组 / 会话信息，已中止');
    }

    const hoverRow = info.daily.find((row) => row.day === targetDay);
    console.log(`hover 当天：积分 ${Number(hoverRow?.credit ?? 0).toFixed(2)}，Token ${hoverRow?.tokens ?? 0}`);
    console.log(`已输出 ${SHOTS.length} 张截图到 ${resolve(out)}`);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
