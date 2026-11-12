// 面板交互验收：通过 CDP 驱动本机 Chrome，核对 usage-panel-polish 的 AC1–AC7。
// 运行前提：`npm run dev` 已启动面板，且有一个带 --remote-debugging-port 的 Chrome。
import { writeFile } from 'node:fs/promises';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9222);
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((item) => item.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      // 等待浏览器启动
    }
    await wait(250);
  }
  throw new Error(`未找到可调试页面，请确认 Chrome 以 --remote-debugging-port=${CDP_PORT} 启动`);
}

function createClient(socket) {
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      task.reject(new Error(message.error.message));
    } else {
      task.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? '页面脚本执行失败');
    }
    return result.result.value;
  };

  return { send, evaluate };
}

async function openPage(client) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1400,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Page.navigate', { url: BASE_URL });
  await wait(2000);
}

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
}

async function setPreset(evaluate, value) {
  await evaluate(`(() => {
    const select = document.querySelector('#filter-preset');
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1200);
}

const summaryUrlExpr = `(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/summary')).at(-1) ?? '')()`;
const requestUrlsExpr = `(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/requests')))()`;

async function main() {
  const target = await findPageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const client = createClient(socket);

  await openPage(client);
  const { evaluate } = client;

  // AC2：tab 结构、ARIA 关联与默认激活
  const structure = JSON.parse(
    await evaluate(`(() => JSON.stringify({
      tabs: [...document.querySelectorAll('[role=tab]')].map((tab) => ({
        id: tab.id,
        selected: tab.getAttribute('aria-selected'),
        controls: tab.getAttribute('aria-controls'),
        targetExists: Boolean(document.getElementById(tab.getAttribute('aria-controls'))),
      })),
      panels: [...document.querySelectorAll('[role=tabpanel]')].map((panel) => ({
        id: panel.id,
        labelledby: panel.getAttribute('aria-labelledby'),
        hidden: panel.hasAttribute('hidden'),
      })),
      canvases: document.querySelectorAll('canvas').length,
    }))()`),
  );
  check(
    'AC2 两个 tab、默认激活 Token、aria-controls 均指向存在的面板',
    structure.tabs.length === 2 &&
      structure.tabs[0].selected === 'true' &&
      structure.tabs[1].selected === 'false' &&
      structure.tabs.every((tab) => tab.targetExists) &&
      structure.panels.length === 2 &&
      structure.panels.every((panel) => panel.labelledby) &&
      structure.panels.some((panel) => panel.hidden),
    JSON.stringify(structure.tabs.map((tab) => tab.id)),
  );

  // AC4：明细默认折叠且折叠时不请求
  const initialRequests = await evaluate(requestUrlsExpr);
  const initialExpanded = JSON.parse(
    await evaluate(`(() => JSON.stringify([...document.querySelectorAll('.table-toggle')].map((btn) => btn.getAttribute('aria-expanded'))))()`),
  );
  await evaluate(`(() => { document.querySelectorAll('.table-toggle')[0].click(); })()`);
  await wait(1400);
  const expandedRequests = await evaluate(requestUrlsExpr);
  const tableState = JSON.parse(
    await evaluate(`(() => {
      const wrap = document.querySelector('.table-body .table-wrap');
      return JSON.stringify({
        expanded: document.querySelector('.table-toggle').getAttribute('aria-expanded'),
        rows: document.querySelectorAll('.table-body tbody tr').length,
        maxHeight: wrap ? getComputedStyle(wrap).maxHeight : null,
        sortedDesc: Boolean(document.querySelector('.table-body th[aria-sort=descending]')),
      });
    })()`),
  );
  check(
    'AC4 明细默认折叠、折叠时不请求、展开后按时间降序且表内滚动',
    initialRequests.length === 0 &&
      initialExpanded.every((value) => value === 'false') &&
      expandedRequests.length === 1 &&
      expandedRequests[0].includes('sort=startedAt&order=desc') &&
      tableState.expanded === 'true' &&
      tableState.rows > 0 &&
      tableState.maxHeight === '440px' &&
      tableState.sortedDesc,
    `折叠请求=${initialRequests.length}、展开请求=${expandedRequests.length}、行数=${tableState.rows}`,
  );

  // AC3：拆分列表固定行数与无内部滚动
  const lists = JSON.parse(
    await evaluate(`(() => JSON.stringify([...document.querySelectorAll('.panel.breakdown')].map((panel) => {
      const list = panel.querySelector('.breakdown-list');
      const rows = [...panel.querySelectorAll('.breakdown-row')];
      return {
        title: panel.querySelector('h3').textContent,
        meta: Number(panel.querySelector('.panel-meta').textContent.replace(' 项', '')),
        shown: rows.length,
        heights: [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)))],
        scrollable: list ? list.scrollHeight > list.clientHeight + 1 : false,
      };
    })))()`),
  );
  check(
    'AC3 拆分列表最多 8 行、行高一致、无内部滚动，项数为全量',
    lists.length === 3 &&
      lists.every((item) => item.shown <= 8 && item.heights.length === 1 && !item.scrollable && item.meta >= item.shown),
    lists.map((item) => `${item.title} ${item.shown}/${item.meta}`).join('，'),
  );

  // AC5 / AC6：token 单位与缓存命中率（与页面实际请求的 summary 对齐）
  const summaryUrl = await evaluate(summaryUrlExpr);
  const summary = await (await fetch(summaryUrl)).json();
  const cards = JSON.parse(
    await evaluate(`(() => JSON.stringify([...document.querySelectorAll('.metric-card')].map((card) => {
      const value = card.querySelector('.metric-value');
      return {
        label: card.querySelector('.metric-label').textContent,
        value: value.firstChild?.textContent ?? '',
        suffix: card.querySelector('.metric-suffix')?.textContent ?? '',
      };
    })))()`),
  );
  const byLabel = Object.fromEntries(cards.map((card) => [card.label, card.value]));
  const suffixByLabel = Object.fromEntries(cards.map((card) => [card.label, card.suffix]));
  const noChineseUnit = await evaluate(`(() => {
    const texts = [...document.querySelectorAll('.metric-value, .breakdown-value, .table-body td')]
      .map((element) => element.textContent)
      .join(' ');
    return !texts.includes('万') && !texts.includes('亿');
  })()`);
  const tokenPattern = /^-?\d+(\.\d)?[KMB]?$/;
  const rate = summary.token.inputTokens > 0 ? ((summary.token.cacheReadTokens / summary.token.inputTokens) * 100).toFixed(1) : null;
  check(
    'AC5 token 使用 K/M/B、计数为整数、页面无「万 / 亿」',
    ['合计 Token', '输入', '输出', '缓存命中'].every((label) => tokenPattern.test(byLabel[label] ?? '')) &&
      /^\d[\d,]*$/.test(byLabel['请求数'] ?? '') &&
      noChineseUnit,
    `合计=${byLabel['合计 Token']} 请求数=${byLabel['请求数']}`,
  );
  const hitSuffix = suffixByLabel['缓存命中'] ?? '';
  check(
    'AC6 缓存命中卡显示命中率，与 summary 手算一致',
    rate === null ? hitSuffix === '—' : hitSuffix === `${rate}%`,
    `显示=${byLabel['缓存命中']} ${hitSuffix}，手算=${rate === null ? '—' : `${rate}%`}`,
  );

  // AC1：列表点击与下拉框写入同一份筛选
  await evaluate(`(() => { document.querySelectorAll('.table-toggle')[0].click(); })()`);
  await wait(600);
  await setPreset(evaluate, 'all');
  const groupRow = JSON.parse(
    await evaluate(`(() => {
      const row = document.querySelector('.panel.breakdown .breakdown-row');
      return JSON.stringify({ key: row.title, name: row.querySelector('.breakdown-name').textContent });
    })()`),
  );
  await evaluate('performance.clearResourceTimings()');
  await evaluate(`(() => { document.querySelector('.panel.breakdown .breakdown-row').click(); })()`);
  await wait(1400);
  const byClick = JSON.parse(
    await evaluate(`(() => JSON.stringify({ group: document.querySelector('#filter-group').value, url: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/summary')).at(-1) ?? '' }))()`),
  );
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1000);
  await setPreset(evaluate, 'all');
  await evaluate('performance.clearResourceTimings()');
  await evaluate(`(() => {
    const select = document.querySelector('#filter-group');
    select.value = ${JSON.stringify(groupRow.key)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1400);
  const bySelect = JSON.parse(
    await evaluate(`(() => JSON.stringify({ group: document.querySelector('#filter-group').value, url: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/summary')).at(-1) ?? '' }))()`),
  );
  check(
    'AC1 列表点击与下拉框写入同一份筛选',
    byClick.group === groupRow.key &&
      bySelect.group === groupRow.key &&
      byClick.url !== '' &&
      byClick.url === bySelect.url,
    `分组=${groupRow.name}，查询串一致=${byClick.url === bySelect.url}`,
  );

  // AC7：0 值隐藏与下拉可切换
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1000);
  await setPreset(evaluate, 'all');
  const modelRows = (await (await fetch(new URL('/api/breakdown?dim=model', BASE_URL))).json()).rows;
  const zeroToken = modelRows.filter((row) => row.totalTokens === 0).map((row) => row.key);
  const zeroCredit = modelRows.filter((row) => row.credit === 0).map((row) => row.key);

  const readModelOptions = `(() => {
    const select = document.querySelector('#filter-model');
    return JSON.stringify({ value: select.value, options: [...select.options].slice(1).map((option) => option.value) });
  })()`;

  const tokenOptions = JSON.parse(await evaluate(readModelOptions));
  const zeroHiddenInToken = zeroToken.every((key) => !tokenOptions.options.includes(key));
  await evaluate(`(() => {
    const select = document.querySelector('#filter-model');
    select.value = ${JSON.stringify(tokenOptions.options[0])};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1400);
  const afterSelect = JSON.parse(await evaluate(readModelOptions));
  const stillSwitchable = afterSelect.options.length === tokenOptions.options.length && afterSelect.value === tokenOptions.options[0];
  await evaluate(`(() => {
    const select = document.querySelector('#filter-model');
    select.value = ${JSON.stringify(afterSelect.options.find((key) => key !== afterSelect.value) ?? afterSelect.value)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(1400);
  const afterSwitch = JSON.parse(await evaluate(readModelOptions));

  await evaluate(`document.querySelector('#credit-tab').click()`);
  await wait(1400);
  const creditOptions = JSON.parse(await evaluate(readModelOptions));
  const zeroHiddenInCredit = zeroCredit
    .filter((key) => key !== creditOptions.value)
    .every((key) => !creditOptions.options.includes(key));

  check(
    'AC7 两个 tab 按主指标隐藏 0 值模型，选中后下拉仍可切换',
    zeroHiddenInToken && zeroHiddenInCredit && stillSwitchable && afterSwitch.value !== afterSelect.value,
    `token 隐藏 ${zeroToken.length} 项、credit 隐藏 ${zeroCredit.length} 项，选中后下拉项 ${afterSelect.options.length} → ${afterSwitch.options.length}`,
  );

  if (SCREENSHOT_DIR) {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const path = `${SCREENSHOT_DIR}/panel-acceptance.png`;
    await writeFile(path, Buffer.from(shot.data, 'base64'));
    console.log(`截图已保存：${path}`);
  }

  socket.close();

  const failed = results.filter((item) => !item.ok);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`验收失败：${error.message}`);
  process.exitCode = 1;
});
