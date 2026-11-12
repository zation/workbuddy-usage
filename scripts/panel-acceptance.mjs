// 面板交互验收：通过 CDP 驱动本机 Chrome，核对 usage-panel-polish 的交互验收项与模型固定色的配色断言。
// 运行前提：`npm run dev` 已启动面板，且有一个带 --remote-debugging-port 的 Chrome。
// 趋势图刻度与配色从页面已加载的 ECharts 实例读取，不改动产品代码。
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
const paletteRequestsExpr = `(() => performance.getEntriesByType('resource')
  .map((entry) => entry.name)
  .filter((name) => {
    try { return new URL(name).search === '?dim=model'; } catch { return false; }
  }))()`;

function normalizeColor(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const numeric = Number.parseInt(hex[1], 16);
    return `rgb(${(numeric >> 16) & 255},${(numeric >> 8) & 255},${numeric & 255})`;
  }
  return value.replace(/\s+/g, '');
}

async function selectModel(evaluate, key) {
  await evaluate(`(() => {
    const trigger = document.querySelector('#filter-model');
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    const option = [...document.querySelectorAll('.model-select-option')]
      .find((item) => item.dataset.model === ${JSON.stringify(key)});
    if (!option) throw new Error('模型下拉缺少选项：' + ${JSON.stringify(key)});
    option.click();
  })()`);
  await wait(1400);
}

let chartModuleUrls = [];

function chartStateExpr() {
  return `(async () => {
  const el = document.querySelector('.chart');
  const urls = ${JSON.stringify(chartModuleUrls)};
  for (const url of urls) {
    try {
      const mod = await import(url);
      const instance = typeof mod.getInstanceByDom === 'function' ? mod.getInstanceByDom(el) : null;
      if (!instance) continue;
      const option = instance.getOption();
      const axis = option.yAxis?.[0]?.axisLabel?.formatter;
      const tip = option.tooltip?.[0]?.valueFormatter;
      return JSON.stringify({
        axis: typeof axis === 'function'
          ? [0, 1000, 10000, 1000000, 1000000000].map((value) => String(axis(value)))
          : null,
        tooltip: typeof tip === 'function'
          ? [1000, 10000, 1000000].map((value) => String(tip(value)))
          : null,
        colors: Object.fromEntries((option.series ?? []).map((s) => [s.id ?? s.name, s.itemStyle?.color])),
      });
    } catch {
      // 该资源不是 echarts core，继续找下一个
    }
  }
  return JSON.stringify({ axis: null, tooltip: null, colors: {} });
})()`;
}

async function readChart(evaluate) {
  return JSON.parse(await evaluate(chartStateExpr()));
}

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
  // 后续会 clearResourceTimings，先缓存 ECharts 模块地址供 readChart 动态导入
  chartModuleUrls = JSON.parse(
    await evaluate(`(() => JSON.stringify(performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /echarts/i.test(name))))()`),
  );

  // 配色专用全量请求必须在脚本自身读取模型行之前核对，避免 resource entries 被污染
  const paletteRequests = await evaluate(paletteRequestsExpr);
  check(
    'AC3 不存在配色专用的全量模型拆分请求',
    paletteRequests.length === 0,
    `无筛选参数的 dim=model 请求 ${paletteRequests.length} 次`,
  );

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
      activeTab: document.querySelector('[role=tab][aria-selected=true]')?.id ?? '',
    }))()`),
  );
  const hiddenPanels = structure.panels.filter((panel) => panel.hidden);
  const inactiveTab = structure.tabs.find((tab) => tab.selected === 'false');
  check(
    'AC2 两个 tab、默认激活 Token、aria-controls 与隐藏面板对应、只渲染一个图表',
    structure.tabs.length === 2 &&
      structure.tabs[0].selected === 'true' &&
      structure.tabs[1].selected === 'false' &&
      structure.tabs.every((tab) => tab.targetExists) &&
      structure.activeTab === structure.tabs[0].id &&
      structure.panels.length === 2 &&
      structure.panels.every((panel) => panel.labelledby) &&
      hiddenPanels.length === 1 &&
      hiddenPanels[0].id === inactiveTab?.controls &&
      structure.canvases === 1,
    `隐藏面板=${hiddenPanels.map((panel) => panel.id).join(',')}，canvas=${structure.canvases}`,
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
  const tokenPattern = /^-?[\d,]+(\.\d)?[KMB]?$/;
  const chart = await readChart(evaluate);
  const axisOk =
    Array.isArray(chart.axis) &&
    chart.axis.every((text) => !text.includes('万') && !text.includes('亿') && !text.includes('k')) &&
    chart.axis.some((text) => /[KMB]$/.test(text));
  const tooltipOk =
    Array.isArray(chart.tooltip) &&
    chart.tooltip.every((text) => !text.includes('万') && !text.includes('亿'));
  const rate = summary.token.inputTokens > 0 ? ((summary.token.cacheReadTokens / summary.token.inputTokens) * 100).toFixed(1) : null;
  check(
    'AC5 token 使用 K/M/B、趋势图刻度与 tooltip 无中文单位、页面无「万 / 亿」',
    ['合计 Token', '输入', '输出', '缓存命中'].every((label) => tokenPattern.test(byLabel[label] ?? '')) &&
      /^\d[\d,]*$/.test(byLabel['请求数'] ?? '') &&
      noChineseUnit &&
      axisOk &&
      tooltipOk,
    `合计=${byLabel['合计 Token']} 请求数=${byLabel['请求数']} y轴=${chart.axis?.join('/') ?? '无'}`,
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
  const tokenChart = await readChart(evaluate);
  await wait(1500);
  const settledChart = await readChart(evaluate);
  const frameStable =
    Object.keys(tokenChart.colors).length > 0 &&
    Object.entries(tokenChart.colors).every(([key, color]) => settledChart.colors[key] === color);
  await setPreset(evaluate, 'today');
  const todayChart = await readChart(evaluate);
  const sharedModelKeys = Object.keys(tokenChart.colors).filter((key) => todayChart.colors[key]);
  const colorsStable =
    sharedModelKeys.length > 0 &&
    sharedModelKeys.every((key) => tokenChart.colors[key] === todayChart.colors[key]);
  await setPreset(evaluate, 'all');
  const modelRows = (await (await fetch(new URL('/api/breakdown?dim=model', BASE_URL))).json()).rows;
  const zeroToken = modelRows.filter((row) => row.totalTokens === 0).map((row) => row.key);
  const zeroCredit = modelRows.filter((row) => row.credit === 0).map((row) => row.key);

  const readModelOptions = `(() => {
    const trigger = document.querySelector('#filter-model');
    return JSON.stringify({
      value: trigger.dataset.model ?? '',
      options: [...document.querySelectorAll('.model-select-option')]
        .map((option) => option.dataset.model ?? '')
        .filter((key) => key !== ''),
    });
  })()`;

  const tokenOptions = JSON.parse(await evaluate(readModelOptions));
  const zeroHiddenInToken = zeroToken.every((key) => !tokenOptions.options.includes(key));
  await selectModel(evaluate, tokenOptions.options[0]);
  await wait(1400);
  const afterSelect = JSON.parse(await evaluate(readModelOptions));
  const stillSwitchable = afterSelect.options.length === tokenOptions.options.length && afterSelect.value === tokenOptions.options[0];
  await selectModel(
    evaluate,
    afterSelect.options.find((key) => key !== afterSelect.value) ?? afterSelect.value,
  );
  await wait(1400);
  const afterSwitch = JSON.parse(await evaluate(readModelOptions));

  // 明细色点与图表颜色在同一筛选下比对，避免默认「今天」与「全部时间」的模型集合差异
  await evaluate(`(() => { document.querySelectorAll('.table-toggle')[0].click(); })()`);
  await wait(1400);
  const tableDot = JSON.parse(
    await evaluate(`(() => {
      const cell = [...document.querySelectorAll('.table-body tbody td')]
        .find((td) => td.querySelector('.model-dot'));
      const dot = cell?.querySelector('.model-dot');
      return JSON.stringify({
        key: cell?.getAttribute('title') ?? '',
        css: dot ? getComputedStyle(dot).backgroundColor : '',
      });
    })()`),
  );
  await evaluate(`(() => { document.querySelectorAll('.table-toggle')[0].click(); })()`);
  await wait(600);

  const dotState = JSON.parse(
    await evaluate(`(() => {
      const panel = [...document.querySelectorAll('.panel.breakdown')]
        .find((item) => item.querySelector('h3')?.textContent === '按模型');
      const row = panel?.querySelector('.breakdown-row');
      const breakdownDot = row?.querySelector('.model-dot');
      const key = row?.getAttribute('title') ?? '';
      const option = [...document.querySelectorAll('.model-select-option')]
        .find((item) => item.dataset.model === key);
      const optionDot = option?.querySelector('.model-dot');
      const triggerDot = document.querySelector('#filter-model .model-dot');
      return JSON.stringify({
        key,
        breakdown: breakdownDot ? getComputedStyle(breakdownDot).backgroundColor : '',
        option: optionDot ? getComputedStyle(optionDot).backgroundColor : '',
        trigger: triggerDot ? getComputedStyle(triggerDot).backgroundColor : '',
      });
    })()`),
  );
  const expectedHex = tokenChart.colors[dotState.key];
  const expectedRgb = normalizeColor(expectedHex ?? '');
  const dotColorsMatch =
    Boolean(expectedHex) &&
    [dotState.breakdown, dotState.option].every((css) => normalizeColor(css) === expectedRgb);
  const triggerExpectedHex = tokenChart.colors[afterSwitch.value];
  const triggerMatch =
    Boolean(triggerExpectedHex) &&
    normalizeColor(dotState.trigger) === normalizeColor(triggerExpectedHex);
  const tableExpectedHex = tokenChart.colors[tableDot.key];
  const tableDotMatch =
    Boolean(tableExpectedHex) && normalizeColor(tableDot.css) === normalizeColor(tableExpectedHex);
  check(
    'AC3 首帧颜色即最终值，无中途变色',
    frameStable,
    `比对 ${Object.keys(tokenChart.colors).length} 个模型`,
  );
  check(
    'AC4 色点跨趋势图、拆分、下拉与明细一致',
    dotColorsMatch && triggerMatch && tableDotMatch,
    `拆分模型=${dotState.key} 图表=${expectedHex}，当前值=${afterSwitch.value} ${triggerExpectedHex}，明细=${tableDot.key} ${tableDot.css}`,
  );

  // 当前选中的模型可能在积分 tab 被 0 值隐藏（R7 预期空态），先回到「全部模型」再读积分图表
  await selectModel(evaluate, '');

  await evaluate(`document.querySelector('#credit-tab').click()`);
  await wait(1400);
  const creditOptions = JSON.parse(await evaluate(readModelOptions));
  const zeroHiddenInCredit = zeroCredit
    .filter((key) => key !== creditOptions.value)
    .every((key) => !creditOptions.options.includes(key));
  const creditChart = await readChart(evaluate);
  const creditAxisOk =
    Array.isArray(creditChart.axis) &&
    creditChart.axis.every((text) => !text.includes('k') && !text.includes('万') && !text.includes('亿')) &&
    Array.isArray(creditChart.tooltip) &&
    creditChart.tooltip.every((text) => !text.includes('k'));

  check(
    'AC7 0 值隐藏、下拉可切换、配色跨筛选稳定、积分刻度无 k',
    zeroHiddenInToken && zeroHiddenInCredit && stillSwitchable &&
      afterSwitch.value !== afterSelect.value &&
      colorsStable && creditAxisOk,
    `token 隐藏 ${zeroToken.length} 项、credit 隐藏 ${zeroCredit.length} 项，选中后下拉项 ${afterSelect.options.length} → ${afterSwitch.options.length}，配色稳定=${colorsStable}（比对 ${sharedModelKeys.length} 个模型），积分轴=${creditChart.axis?.join('/') ?? '无'}`,
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
