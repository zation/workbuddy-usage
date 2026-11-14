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
  // 无头窗口常被判为未聚焦，focus 事件不触发；开启焦点模拟才能验证键盘可达
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
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
  const label = ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  console.log(`${label} ${name}${detail ? ` :: ${detail}` : ''}`);
}

/** 展开下拉并点选指定业务键；点击与读取分两次 evaluate，等 React 完成重渲染。 */
async function chooseOption(evaluate, triggerSelector, value, settle = 1200) {
  await evaluate(`(() => {
    const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  })()`);
  await wait(200);
  await evaluate(`(() => {
    const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
    const container = trigger.closest('.select');
    const option = [...container.querySelectorAll('.select-option')]
      .find((item) => item.dataset.value === ${JSON.stringify(value)});
    if (!option) throw new Error('下拉缺少选项：' + ${JSON.stringify(value)});
    option.click();
  })()`);
  await wait(settle);
}

const BUSINESS_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function addDays(key, delta) {
  const [year, month, day] = key.split('-').map((value) => Number.parseInt(value, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function daySpan(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

function todayKey() {
  const now = new Date(Date.now() + BUSINESS_TZ_OFFSET_MS);
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

/** 点时间快捷按钮，等待 React 重渲染与数据刷新。 */
async function clickQuick(evaluate, key, settle = 1300) {
  await evaluate(`(() => {
    const button = document.querySelector('[data-quick=${JSON.stringify(key)}]');
    if (!button) throw new Error('缺少快捷按钮：' + ${JSON.stringify(key)});
    button.click();
  })()`);
  await wait(settle);
}

/** 用原生 setter 改日期框并派发 input，模拟用户输入。 */
async function typeDate(evaluate, index, value, settle = 300) {
  await evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const input = document.querySelectorAll('.date-range input[type=date]')[${index}];
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(settle);
}

async function readTimeState(evaluate) {
  return JSON.parse(
    await evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.date-range input[type=date]')];
      const buttons = [...document.querySelectorAll('[data-quick]')];
      return JSON.stringify({
        from: inputs[0]?.value ?? '',
        to: inputs[1]?.value ?? '',
        buttons: buttons.map((button) => button.dataset.quick ?? ''),
        pressed: buttons
          .filter((button) => button.getAttribute('aria-pressed') === 'true')
          .map((button) => button.dataset.quick ?? ''),
        pressedAttrs: buttons.map((button) => button.getAttribute('aria-pressed')),
        selectsInTime: document.querySelectorAll('.filter-time .select').length,
        groupRole: document.querySelector('.filter-time [role=group]')?.getAttribute('aria-label') ?? '',
        error: document.querySelector('.filter-error')?.textContent ?? '',
      });
    })()`),
  );
}

/** 写日期区间：先写不会越界的一端，避免中间态被前端拦截。 */
async function setRange(evaluate, from, to, settle = 1300) {
  const current = await readTimeState(evaluate);
  if (current.to && from > current.to) {
    await typeDate(evaluate, 1, to);
    await typeDate(evaluate, 0, from);
  } else {
    await typeDate(evaluate, 0, from);
    await typeDate(evaluate, 1, to);
  }
  await wait(settle);
}

/** 用「数据最早日期 → 今天」覆盖全量；跨度超过 100 天时明确报错，见 docs/devops.md。 */
async function setWideRange(evaluate, settle = 1400) {
  const series = await (await fetch(new URL('/api/timeseries', BASE_URL))).json();
  const dates = series.rows.map((row) => row.date).sort();
  const from = dates[0];
  const to = todayKey();
  if (!from) {
    throw new Error('时序接口没有数据，无法建立全量区间');
  }
  if (daySpan(from, to) > 100) {
    throw new Error(`数据跨度 ${daySpan(from, to)} 天超过 100 天上限，请按 docs/devops.md 调整验收取数`);
  }
  await setRange(evaluate, from, to, settle);
  return { from, to };
}

async function readGroupTooltip(evaluate) {
  return JSON.parse(
    await evaluate(`(() => {
      const tip = document.querySelector('.breakdown-tooltip');
      if (!tip) return JSON.stringify({ open: false });
      const items = [...tip.querySelectorAll('.breakdown-tooltip-list li')];
      return JSON.stringify({
        open: true,
        title: tip.querySelector('.breakdown-tooltip-title')?.textContent ?? '',
        total: tip.querySelector('.breakdown-tooltip-total')?.textContent ?? '',
        key: tip.querySelector('.breakdown-tooltip-key')?.textContent ?? '',
        models: items.map((item) => item.querySelector('.breakdown-tooltip-model')?.textContent ?? ''),
        values: items.map((item) => item.querySelector('.breakdown-tooltip-value')?.textContent ?? ''),
        colors: items.map((item) => {
          const dot = item.querySelector('.model-dot');
          return dot ? getComputedStyle(dot).backgroundColor : '';
        }),
        empty: Boolean(tip.querySelector('.breakdown-tooltip-empty')),
        pointerEvents: getComputedStyle(tip).pointerEvents,
      });
    })()`),
  );
}

/** 悬浮分组首行并读回明细提示，随后移出以恢复原状。 */
async function readFirstGroupRow(evaluate) {
  await evaluate(`(() => {
    document.querySelector('.panel.breakdown .breakdown-row')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  })()`);
  await wait(250);
  const tip = await readGroupTooltip(evaluate);
  const name = await evaluate(
    `document.querySelector('.panel.breakdown .breakdown-name')?.textContent ?? ''`,
  );
  await evaluate(`(() => {
    document.querySelector('.panel.breakdown .breakdown-row')
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  })()`);
  await wait(150);
  return { key: tip.key ?? '', name };
}

/** 读触发按钮的业务键与当前渲染出的选项（含空值项与兜底项）。 */
async function readSelect(evaluate, triggerSelector) {
  return JSON.parse(
    await evaluate(`(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      const container = trigger.closest('.select');
      return JSON.stringify({
        value: trigger.dataset.value ?? '',
        options: [...container.querySelectorAll('.select-option')].map((option) => option.dataset.value ?? ''),
      });
    })()`),
  );
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
  await chooseOption(evaluate, '#filter-model', key, 1400);
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
      const formatter = option.tooltip?.[0]?.formatter;
      const hasValueFormatter = typeof option.tooltip?.[0]?.valueFormatter === 'function';
      const probe = (items) => {
        try {
          return String(formatter(items));
        } catch (error) {
          return 'ERROR:' + error.message;
        }
      };
      return JSON.stringify({
        axis: typeof axis === 'function'
          ? [0, 1000, 10000, 1000000, 1000000000].map((value) => String(axis(value)))
          : null,
        categories: Array.isArray(option.xAxis?.[0]?.data) ? option.xAxis[0].data : [],
        tooltip: typeof formatter === 'function'
          ? [1000, 10000, 1000000].map((value) => probe([
              { axisValue: '2026-11-12', seriesName: '模型甲', value, marker: '' },
            ]))
          : null,
        hasValueFormatter,
        formatter: typeof formatter === 'function'
          ? {
              mixed: probe([
                { axisValue: '2026-11-12', seriesName: '模型甲', value: 1200, marker: '<i class="m1"></i>' },
                { axisValue: '2026-11-12', seriesName: '模型乙', value: 0, marker: '<i class="m2"></i>' },
                { axisValue: '2026-11-12', seriesName: '模型丙', value: 340, marker: '<i class="m3"></i>' },
              ]),
              empty: probe([
                { axisValue: '2026-11-13', seriesName: '模型甲', value: 0, marker: '<i class="m1"></i>' },
              ]),
            }
          : null,
        colors: Object.fromEntries((option.series ?? []).map((s) => [s.id ?? s.name, s.itemStyle?.color])),
        yAxes: (Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]).map((a) => ({
          name: a?.name ?? null,
          type: a?.type ?? null,
        })),
        ratioSeries: (option.series ?? [])
          .filter((s) => s.id === 'price-ratio')
          .map((s) => ({
            type: s.type,
            yAxisIndex: s.yAxisIndex,
            connectNulls: s.connectNulls,
            data: s.data,
          })),
        legendData: Array.isArray(option.legend?.[0]?.data) ? option.legend[0].data : [],
        ratioTip: typeof formatter === 'function'
          ? probe([
              { axisValue: '2026-11-12', seriesId: 'model-a', seriesName: '模型甲', value: 1200, marker: '' },
              { axisValue: '2026-11-12', seriesId: 'zero-model', seriesName: '模型乙', value: 0, marker: '' },
              { axisValue: '2026-11-12', seriesId: 'price-ratio', seriesName: '价格比率', value: 4.16, marker: '' },
            ])
          : null,
      });
    } catch {
      // 该资源不是 echarts core，继续找下一个
    }
  }
  return JSON.stringify({ axis: null, tooltip: null, formatter: null, hasValueFormatter: false, colors: {} });
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

  // AC9：除同源面板资源外，页面不请求任何外部域名
  const externalRequests = JSON.parse(
    await evaluate(`(() => JSON.stringify(
      performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => {
          try { return new URL(name).hostname !== location.hostname; } catch { return true; }
        })
    ))()`),
  );
  check(
    'AC9 页面不产生外部域名请求',
    externalRequests.length === 0,
    externalRequests.length === 0 ? '仅同源请求' : externalRequests.join(', '),
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
    chart.tooltip.every(
      (text) => !text.includes('万') && !text.includes('亿') && !text.includes('ERROR'),
    );
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
  await setWideRange(evaluate);
  const groupRow = await readFirstGroupRow(evaluate);
  await evaluate('performance.clearResourceTimings()');
  await evaluate(`(() => { document.querySelector('.panel.breakdown .breakdown-row').click(); })()`);
  await wait(1400);
  const byClick = JSON.parse(
    await evaluate(`(() => JSON.stringify({ group: document.querySelector('#filter-group').dataset.value ?? '', url: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/summary')).at(-1) ?? '' }))()`),
  );
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1000);
  await setWideRange(evaluate);
  await evaluate('performance.clearResourceTimings()');
  await chooseOption(evaluate, '#filter-group', groupRow.key, 1400);
  const bySelect = JSON.parse(
    await evaluate(`(() => JSON.stringify({ group: document.querySelector('#filter-group').dataset.value ?? '', url: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/api/summary')).at(-1) ?? '' }))()`),
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
  await setWideRange(evaluate);
  const tokenChart = await readChart(evaluate);
  await wait(1500);
  const settledChart = await readChart(evaluate);
  const frameStable =
    Object.keys(tokenChart.colors).length > 0 &&
    Object.entries(tokenChart.colors).every(([key, color]) => settledChart.colors[key] === color);
  await clickQuick(evaluate, 'today');
  const todayChart = await readChart(evaluate);
  const sharedModelKeys = Object.keys(tokenChart.colors).filter((key) => todayChart.colors[key]);
  const colorsStable =
    sharedModelKeys.length > 0 &&
    sharedModelKeys.every((key) => tokenChart.colors[key] === todayChart.colors[key]);
  await setWideRange(evaluate);
  const modelRows = (await (await fetch(new URL('/api/breakdown?dim=model', BASE_URL))).json()).rows;
  const zeroToken = modelRows.filter((row) => row.totalTokens === 0).map((row) => row.key);
  const zeroCredit = modelRows.filter((row) => row.credit === 0).map((row) => row.key);

  const readModelOptions = async () => {
    const state = await readSelect(evaluate, '#filter-model');
    return { value: state.value, options: state.options.filter((key) => key !== '') };
  };

  const tokenOptions = await readModelOptions();
  const zeroHiddenInToken = zeroToken.every((key) => !tokenOptions.options.includes(key));
  await selectModel(evaluate, tokenOptions.options[0]);
  await wait(1400);
  const afterSelect = await readModelOptions();
  const stillSwitchable = afterSelect.options.length === tokenOptions.options.length && afterSelect.value === tokenOptions.options[0];
  await selectModel(
    evaluate,
    afterSelect.options.find((key) => key !== afterSelect.value) ?? afterSelect.value,
  );
  await wait(1400);
  const afterSwitch = await readModelOptions();

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
      const container = document.querySelector('#filter-model').closest('.select');
      const option = [...container.querySelectorAll('.select-option')]
        .find((item) => item.dataset.value === key);
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
  const creditOptions = await readModelOptions();
  const zeroHiddenInCredit = zeroCredit
    .filter((key) => key !== creditOptions.value)
    .every((key) => !creditOptions.options.includes(key));
  const creditChart = await readChart(evaluate);
  const creditAxisOk =
    Array.isArray(creditChart.axis) &&
    creditChart.axis.every((text) => !text.includes('k') && !text.includes('万') && !text.includes('亿')) &&
    Array.isArray(creditChart.tooltip) &&
    creditChart.tooltip.every((text) => !text.includes('k') && !text.includes('ERROR'));

  check(
    'AC7 0 值隐藏、下拉可切换、配色跨筛选稳定、积分刻度无 k',
    zeroHiddenInToken && zeroHiddenInCredit && stillSwitchable &&
      afterSwitch.value !== afterSelect.value &&
      colorsStable && creditAxisOk,
    `token 隐藏 ${zeroToken.length} 项、credit 隐藏 ${zeroCredit.length} 项，选中后下拉项 ${afterSelect.options.length} → ${afterSwitch.options.length}，配色稳定=${colorsStable}（比对 ${sharedModelKeys.length} 个模型），积分轴=${creditChart.axis?.join('/') ?? '无'}`,
  );

  // 复位到「全部时间 + 无筛选」，后续断言在同一条基线上执行
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1000);
  await setWideRange(evaluate);
  await evaluate(`document.querySelector('#token-tab').click()`);
  await wait(1500);

  const autoPathPattern = /[\\/]workbuddy[\\/]\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/i;
  const fetchJson = async (path) => (await fetch(new URL(path, BASE_URL))).json();

  // AC2：分组下拉完全由服务层聚合结果驱动
  const groupApi = await fetchJson('/api/breakdown?dim=group');
  const groupState = await readSelect(evaluate, '#filter-group');
  const groupOptionKeys = groupState.options.filter((key) => key !== '');
  const dateEntries = groupOptionKeys.filter((key) => autoPathPattern.test(key));
  const apiKeys = groupApi.rows.map((row) => row.key).sort();
  const sortedOptionKeys = [...groupOptionKeys].sort();
  const hasDefaultOption = groupOptionKeys.includes('默认');
  const hasDefaultApi = apiKeys.includes('默认');
  check(
    'AC2 分组下拉无日期目录条目且与聚合结果一致',
    dateEntries.length === 0 &&
      JSON.stringify(sortedOptionKeys) === JSON.stringify(apiKeys) &&
      hasDefaultOption === hasDefaultApi,
    `选项 ${groupOptionKeys.length} 项、日期条目 ${dateEntries.length} 项、含「默认」=下拉 ${hasDefaultOption} / 接口 ${hasDefaultApi}`,
  );

  // AC2 边界：当前范围没有自动分组请求时「默认」不占位
  const earliest = (await fetchJson('/api/timeseries')).rows.map((row) => row.date).sort()[0];
  const emptyDate = addDays(earliest, -1);
  await setRange(evaluate, emptyDate, emptyDate);
  const emptyRangeState = await readSelect(evaluate, '#filter-group');
  const emptyRangeApi = await fetchJson(`/api/breakdown?dim=group&from=${emptyDate}&to=${emptyDate}`);
  check(
    'AC2 空范围内「默认」不占位',
    emptyRangeApi.rows.length === 0 && JSON.stringify(emptyRangeState.options) === JSON.stringify(['']),
    `空区间 ${emptyDate}：接口 ${emptyRangeApi.rows.length} 行、下拉 ${emptyRangeState.options.length} 项`,
  );
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1000);
  await setWideRange(evaluate);

  // AC4：虚拟业务键筛选作用于四个端点
  let ac4Ok = false;
  let ac4Detail = '当前数据没有自动分组请求，无法验证';
  if (hasDefaultOption) {
    await evaluate('performance.clearResourceTimings()');
    await chooseOption(evaluate, '#filter-group', '默认', 1600);
    const afterDefault = await readSelect(evaluate, '#filter-group');
    const summaryUrlNow = await evaluate(summaryUrlExpr);
    const encoded = encodeURIComponent('默认');
    const query = `group=${encoded}`;
    const [summary, groups, sessions, models, timeseries, requests] = await Promise.all([
      fetchJson(`/api/summary?${query}`),
      fetchJson(`/api/breakdown?dim=group&${query}`),
      fetchJson(`/api/breakdown?dim=session&${query}`),
      fetchJson(`/api/breakdown?dim=model&${query}`),
      fetchJson(`/api/timeseries?${query}`),
      fetchJson(`/api/requests?${query}`),
    ]);
    const requestGroups = [...new Set(requests.rows.map((row) => row.group))];
    const allAuto = requestGroups.length > 0 && requestGroups.every((key) => autoPathPattern.test(key));
    const requestSessions = [...new Set(requests.rows.map((row) => row.session))].sort();
    const requestModels = [...new Set(requests.rows.map((row) => row.model))].sort();
    const timeseriesTokens = timeseries.rows.reduce((total, row) => total + row.totalTokens, 0);
    ac4Ok =
      afterDefault.value === '默认' &&
      summaryUrlNow.includes(encoded) &&
      groups.rows.length === 1 &&
      groups.rows[0]?.key === '默认' &&
      allAuto &&
      JSON.stringify(requestSessions) === JSON.stringify(sessions.rows.map((row) => row.key).sort()) &&
      JSON.stringify(requestModels) === JSON.stringify(models.rows.map((row) => row.key).sort()) &&
      timeseriesTokens === summary.token.totalTokens;
    ac4Detail =
      `回显=${afterDefault.value}、URL 含编码键=${summaryUrlNow.includes(encoded)}、` +
      `分组行=${groups.rows.length}、明细 ${requests.rows.length} 条全为自动路径=${allAuto}、` +
      `会话/模型与明细一致=${ac4Ok}、token 一致=${timeseriesTokens === summary.token.totalTokens}`;
    await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
    await wait(1000);
    await setWideRange(evaluate);
  }
  check('AC4 选中「默认」后四个端点只含自动分组数据', ac4Ok, ac4Detail);

  // AC12：三个维度下拉的 ARIA 组合与交互一致，时间区为快捷按钮 + 常驻日期框
  const ariaState = JSON.parse(
    await evaluate(`(() => JSON.stringify(
      ['#filter-group', '#filter-session', '#filter-model'].map((selector) => {
        const trigger = document.querySelector(selector);
        const container = trigger.closest('.select');
        const controls = trigger.getAttribute('aria-controls');
        return {
          selector,
          role: trigger.getAttribute('role'),
          haspopup: trigger.getAttribute('aria-haspopup'),
          expanded: trigger.getAttribute('aria-expanded'),
          controls,
          controlsExists: Boolean(document.getElementById(controls)),
          activedescendant: trigger.getAttribute('aria-activedescendant'),
          selected: container.querySelectorAll('.select-option[aria-selected="true"]').length,
        };
      })
    ))()`),
  );
  const ariaOk =
    ariaState.length === 3 &&
    ariaState.every(
      (item) =>
        item.role === 'combobox' &&
        item.haspopup === 'listbox' &&
        item.expanded === 'false' &&
        item.controlsExists &&
        item.activedescendant === null &&
        item.selected === 1,
    );

  const pressKey = async (key) => {
    await evaluate(`(() => {
      const trigger = document.querySelector('#filter-group');
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    })()`);
    await wait(250);
  };
  const groupOpenState = async () =>
    JSON.parse(
      await evaluate(`(() => {
        const trigger = document.querySelector('#filter-group');
        const id = trigger.getAttribute('aria-activedescendant');
        const active = id ? document.getElementById(id) : null;
        const container = trigger.closest('.select');
        return JSON.stringify({
          expanded: trigger.getAttribute('aria-expanded'),
          activeId: id ?? '',
          activeValue: active?.dataset.value ?? '',
          value: trigger.dataset.value ?? '',
          options: container.querySelectorAll('.select-option').length,
        });
      })()`),
    );

  await pressKey('ArrowDown');
  const opened = await groupOpenState();
  await pressKey('ArrowDown');
  const moved = await groupOpenState();
  await pressKey('Enter');
  await wait(1400);
  const afterEnter = await groupOpenState();
  await pressKey('ArrowDown');
  await pressKey('Escape');
  const afterEscape = await groupOpenState();
  await pressKey('ArrowDown');
  await evaluate(`(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); })()`);
  await wait(250);
  const afterOutside = await groupOpenState();

  const keyboardOk =
    opened.expanded === 'true' &&
    opened.activeId !== '' &&
    opened.options > 1 &&
    moved.activeId !== opened.activeId &&
    afterEnter.expanded === 'false' &&
    afterEnter.value === moved.activeValue &&
    afterEscape.expanded === 'false' &&
    afterOutside.expanded === 'false';
  await chooseOption(evaluate, '#filter-group', '', 1400);

  const timeLayout = await readTimeState(evaluate);
  const dateInputCount = await evaluate(
    `document.querySelectorAll('.filter-time .date-range input[type=date]').length`,
  );
  const layoutOk =
    timeLayout.buttons.join(',') === 'today,threeDays,sevenDays,thirtyDays' &&
    timeLayout.pressedAttrs.every((value) => value === 'true' || value === 'false') &&
    timeLayout.selectsInTime === 0 &&
    timeLayout.groupRole === '时间范围' &&
    dateInputCount === 2;

  check(
    'AC12 三个维度下拉 ARIA 一致、键盘与点击外部关闭可用，时间区为四个快捷按钮 + 两个日期框',
    ariaOk && keyboardOk && layoutOk,
    `ARIA=${ariaOk}（${ariaState.map((item) => item.expanded).join('/')}）、键盘=${keyboardOk}、` +
      `快捷按钮=${timeLayout.buttons.join('/')}、时间区下拉=${timeLayout.selectsInTime}、日期框=${dateInputCount}`,
  );

  // AC13：两张趋势图的 tooltip 都过滤 0 值
  await evaluate(`document.querySelector('#token-tab').click()`);
  await wait(1500);
  const tokenChartRule = await readChart(evaluate);
  await evaluate(`document.querySelector('#credit-tab').click()`);
  await wait(1500);
  const creditChartRule = await readChart(evaluate);
  const tooltipRule = (state) => {
    const formatter = state?.formatter;
    if (!formatter) {
      return false;
    }
    return (
      formatter.mixed.includes('2026-11-12') &&
      formatter.mixed.includes('模型甲') &&
      formatter.mixed.includes('模型丙') &&
      !formatter.mixed.includes('模型乙') &&
      formatter.mixed.indexOf('模型甲') < formatter.mixed.indexOf('模型丙') &&
      formatter.empty.includes('2026-11-13') &&
      formatter.empty.includes('无数据') &&
      !formatter.empty.includes('模型甲')
    );
  };
  check(
    'AC13 两张趋势图 tooltip 过滤 0 值并保留日期',
    tooltipRule(tokenChartRule) && tooltipRule(creditChartRule),
    `Token=${tooltipRule(tokenChartRule)}、积分=${tooltipRule(creditChartRule)}`,
  );

  // ===== 时间控件、日期轴、跨度上限与分组分段 =====
  await evaluate(`document.querySelector('#token-tab').click()`);
  await wait(1200);
  await evaluate(`(() => { [...document.querySelectorAll('button')].find((button) => button.textContent === '重置').click(); })()`);
  await wait(1500);

  const today = todayKey();
  const threeStart = addDays(today, -2);
  const defaultTime = await readTimeState(evaluate);
  check(
    'AC1 时间区为四个快捷按钮 +「更多」展开的起止框，首屏默认近 3 天',
    defaultTime.buttons.join(',') === 'today,threeDays,sevenDays,thirtyDays' &&
      defaultTime.pressed.join(',') === 'threeDays' &&
      defaultTime.from === threeStart &&
      defaultTime.to === today &&
      defaultTime.selectsInTime === 0,
    `按钮=${defaultTime.buttons.join('/')}、高亮=${defaultTime.pressed.join('/')}、区间=${defaultTime.from}→${defaultTime.to}`,
  );

  const quickCases = [
    ['today', today, today],
    ['threeDays', threeStart, today],
    ['sevenDays', addDays(today, -6), today],
    ['thirtyDays', addDays(today, -29), today],
  ];
  let quickOk = true;
  const quickDetails = [];
  for (const [key, from, to] of quickCases) {
    await clickQuick(evaluate, key);
    const state = await readTimeState(evaluate);
    const url = await evaluate(summaryUrlExpr);
    const matched =
      state.pressed.join(',') === key &&
      state.from === from &&
      state.to === to &&
      url.includes(`from=${from}`) &&
      url.includes(`to=${to}`);
    quickOk = quickOk && matched;
    quickDetails.push(`${key}:${state.from}→${state.to}/${state.pressed.join('/')}`);
  }

  await clickQuick(evaluate, 'sevenDays');
  await typeDate(evaluate, 0, threeStart);
  await wait(1300);
  const backToThree = await readTimeState(evaluate);
  await typeDate(evaluate, 0, addDays(today, -3));
  await wait(1300);
  const customTime = await readTimeState(evaluate);
  check(
    'AC2 快捷按钮回填区间且查询串一致，手动改日期按反向匹配重算高亮',
    quickOk &&
      backToThree.pressed.join(',') === 'threeDays' &&
      customTime.pressed.length === 0 &&
      customTime.from === addDays(today, -3) &&
      customTime.to === today,
    `${quickDetails.join('；')}，手改命中=${backToThree.pressed.join('/')}，自定义高亮 ${customTime.pressed.length} 个`,
  );

  await clickQuick(evaluate, 'threeDays');
  await typeDate(evaluate, 0, today);
  await wait(1300);
  await evaluate('performance.clearResourceTimings()');
  await typeDate(evaluate, 1, addDays(today, -5));
  await wait(1000);
  const inverted = await readTimeState(evaluate);
  const requestsAfterInverted = await evaluate(
    `(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/summary')).length)()`,
  );
  await evaluate(`(() => {
    const input = document.querySelectorAll('.date-range input[type=date]')[1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(400);
  const afterClear = await readTimeState(evaluate);
  check(
    'AC3 起始晚于结束不写入筛选且不发请求，清空日期框回弹到生效值',
    inverted.error === '起始日期不能晚于结束日期' &&
      inverted.from === today &&
      requestsAfterInverted === 0 &&
      afterClear.to === today,
    `错误=${inverted.error || '无'}、非法后 summary 请求=${requestsAfterInverted}、清空后结束日期=${afterClear.to}`,
  );

  await clickQuick(evaluate, 'sevenDays');
  const sevenChart = await readChart(evaluate);
  const seriesApi = await fetchJson('/api/timeseries');
  check(
    'AC8 /api/timeseries 不含 days，面板按区间补轴，近 7 天画满 7 格',
    !('days' in seriesApi) &&
      sevenChart.categories.length === 7 &&
      sevenChart.categories[0] === addDays(today, -6) &&
      sevenChart.categories.at(-1) === today,
    `响应含 days=${'days' in seriesApi}、类目 ${sevenChart.categories.length} 个（${sevenChart.categories[0]}→${sevenChart.categories.at(-1)}）`,
  );

  const hundredFrom = addDays(today, -99);
  await setRange(evaluate, hundredFrom, today);
  await wait(600);
  const hundredChart = await readChart(evaluate);
  await evaluate('performance.clearResourceTimings()');
  await typeDate(evaluate, 0, addDays(today, -100));
  await wait(1200);
  const invalidTime = await readTimeState(evaluate);
  const requestsAfterInvalid = await evaluate(
    `(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/summary')).length)()`,
  );
  const tooLongResponse = await fetch(
    new URL(`/api/summary?from=${addDays(today, -100)}&to=${today}`, BASE_URL),
  );
  const tooLongBody = await tooLongResponse.json();
  const fullResponse = await fetch(new URL('/api/summary', BASE_URL));
  const fullBody = await fullResponse.json();
  await clickQuick(evaluate, 'sevenDays');
  const recoveredTime = await readTimeState(evaluate);
  const recoveredChart = await readChart(evaluate);
  check(
    'AC9 100 天区间正常生效，101 天被前端与 API 用同一文案拦截',
    hundredChart.categories.length === 100 &&
      invalidTime.error === '时间跨度不能超过 100 天' &&
      requestsAfterInvalid === 0 &&
      tooLongResponse.status === 400 &&
      tooLongBody.error === '时间跨度不能超过 100 天' &&
      fullResponse.status === 200 &&
      fullBody.token.totalTokens > 0 &&
      recoveredTime.error === '' &&
      recoveredChart.categories.length === 7,
    `100 天类目=${hundredChart.categories.length}、101 天提示=${invalidTime.error || '无'}、` +
      `越界后请求=${requestsAfterInvalid}、API=${tooLongResponse.status}/${tooLongBody.error}、` +
      `无日期请求=${fullResponse.status}、恢复后类目=${recoveredChart.categories.length}`,
  );

  const ratioApi = await fetchJson(`/api/timeseries?from=${addDays(today, -6)}&to=${today}`);
  const ratioChart = await readChart(evaluate);
  const hasRatios = Array.isArray(ratioApi.ratios) && ratioApi.ratios.length > 0;
  const ratioLines = ratioChart.ratioSeries ?? [];
  const ratioAxes = ratioChart.yAxes ?? [];
  const ratioShown = hasRatios
    ? ratioAxes.length === 2 &&
      ratioAxes[1]?.name === '×' &&
      ratioLines.length === 1 &&
      ratioLines[0].type === 'line' &&
      ratioLines[0].yAxisIndex === 1 &&
      ratioLines[0].connectNulls === false &&
      ratioLines[0].data.length === ratioChart.categories.length &&
      !(ratioChart.legendData ?? []).includes('价格比率') &&
      ratioChart.hasValueFormatter === false
    : ratioAxes.length === 1 && ratioLines.length === 0 && ratioChart.hasValueFormatter === false;
  check(
    'AC10 Token 图按 DS 数据叠加价格比率折线，无 DS 数据时隐藏',
    ratioShown,
    `ratios=${ratioApi.ratios?.length ?? 0}、y 轴 ${ratioAxes.length} 个、折线 ${ratioLines.length} 条、` +
      `右轴=${ratioAxes[1]?.name ?? '无'}、死配置已移除=${ratioChart.hasValueFormatter === false}`,
  );

  const ratioTipOk =
    typeof ratioChart.ratioTip === 'string' &&
    ratioChart.ratioTip.includes('DeepSeek 费用比率：4.16×') &&
    ratioChart.ratioTip.includes('1.2K') &&
    !ratioChart.ratioTip.includes('模型乙') &&
    !ratioChart.ratioTip.includes('ERROR');
  check(
    'AC10 tooltip 比率行带标题与 ×，柱子仍按原规则过滤排序',
    hasRatios ? ratioTipOk : 'skip',
    hasRatios
      ? `标题=${ratioChart.ratioTip?.includes('DeepSeek 费用比率') ?? false}、` +
        `柱子格式=${ratioChart.ratioTip?.includes('1.2K') ?? false}、` +
        `0 值隐藏=${!(ratioChart.ratioTip ?? '').includes('模型乙')}`
      : '当前区间无 DS 请求，比率 tooltip 未覆盖',
  );

  await clickQuick(evaluate, 'thirtyDays');
  const ratioModelRows = (await fetchJson('/api/breakdown?dim=model')).rows.filter(
    (row) => row.totalTokens > 0,
  );
  const ratioCandidates = await Promise.all(
    ratioModelRows.map(async (row) => {
      const body = await fetchJson(
        `/api/timeseries?model=${encodeURIComponent(row.key)}&from=${addDays(today, -29)}&to=${today}`,
      );
      return { key: row.key, empty: Array.isArray(body.ratios) && body.ratios.length === 0 };
    }),
  );
  const nonDsKey = ratioCandidates.find((item) => item.empty)?.key;
  if (nonDsKey) {
    await selectModel(evaluate, nonDsKey);
    await wait(600);
    const nonDsChart = await readChart(evaluate);
    const pageText = await evaluate(`document.body.innerText`);
    check(
      'AC14 筛选非 DS 模型时比率折线整体隐藏，页面无新增文案',
      (nonDsChart.yAxes ?? []).length === 1 &&
        (nonDsChart.ratioSeries ?? []).length === 0 &&
        !pageText.includes('DeepSeek 费用比率'),
      `模型=${nonDsKey}、y 轴 ${(nonDsChart.yAxes ?? []).length} 个、` +
        `折线 ${(nonDsChart.ratioSeries ?? []).length} 条、` +
        `新增文案=${pageText.includes('DeepSeek 费用比率')}`,
    );
    await selectModel(evaluate, '');
    await wait(600);
  } else {
    check('AC14 筛选非 DS 模型时比率折线整体隐藏，页面无新增文案', 'skip', '当前区间没有可筛的非 DS 模型');
  }

  await clickQuick(evaluate, 'thirtyDays');
  await wait(1200);
  const segmentState = JSON.parse(
    await evaluate(`(() => {
      const panels = [...document.querySelectorAll('.panel.breakdown')];
      const group = panels.find((panel) => panel.querySelector('h3')?.textContent === '按分组');
      const others = panels.filter((panel) => panel !== group);
      const row = group?.querySelector('.breakdown-row');
      const bar = row?.querySelector('.breakdown-bar');
      const segments = [...(bar?.querySelectorAll('.breakdown-segment') ?? [])];
      return JSON.stringify({
        segments: segments.length,
        colors: segments.map((item) => getComputedStyle(item).backgroundColor),
        widths: segments.map((item) => item.getBoundingClientRect().width),
        barWidth: bar ? bar.getBoundingClientRect().width : 0,
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : 0,
        otherSegments: others.reduce((sum, panel) => sum + panel.querySelectorAll('.breakdown-segment').length, 0),
        otherFills: others.reduce((sum, panel) => sum + panel.querySelectorAll('.breakdown-fill').length, 0),
      });
    })()`),
  );

  await evaluate(`(() => {
    document.querySelector('.panel.breakdown .breakdown-row')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  })()`);
  await wait(300);
  const groupTip = await readGroupTooltip(evaluate);
  const rowHeightOpen = await evaluate(
    `Math.round(document.querySelector('.panel.breakdown .breakdown-row').getBoundingClientRect().height)`,
  );
  const chartForSegments = await readChart(evaluate);
  const timeNow = await readTimeState(evaluate);
  const splitApi = await fetchJson(
    `/api/breakdown?dim=group&split=model&from=${timeNow.from}&to=${timeNow.to}`,
  );
  const splitRow = splitApi.rows.find((row) => row.key === groupTip.key);
  const expectedSegments = (splitRow?.models ?? [])
    .filter((segment) => segment.totalTokens > 0)
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens || left.model.localeCompare(right.model),
    );
  const modelKeyByName = new Map(
    (await fetchJson('/api/breakdown?dim=model')).rows.map((row) => [row.name, row.key]),
  );
  const expectedColors = expectedSegments.map((segment) =>
    normalizeColor(chartForSegments.colors[segment.model] ?? ''),
  );
  const widthsSum = segmentState.widths.reduce((sum, width) => sum + width, 0);
  // 原单色条宽 = 条容器宽 × 行占比；段宽之和应与它一致
  const expectedWidth = (splitRow?.tokenShare ?? 0) * segmentState.barWidth;
  const segmentsMatch =
    segmentState.segments > 0 &&
    segmentState.segments === expectedSegments.length &&
    segmentState.colors.map(normalizeColor).every((color, index) => color === expectedColors[index]);

  await evaluate(`(() => {
    document.querySelector('.panel.breakdown .breakdown-row')
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  })()`);
  await wait(200);
  const tipAfterLeave = await readGroupTooltip(evaluate);
  await evaluate(`(() => {
    const row = document.querySelector('.panel.breakdown .breakdown-row');
    row.blur();
    row.focus();
  })()`);
  await wait(300);
  const focusTip = await readGroupTooltip(evaluate);
  await evaluate(`document.querySelector('.panel.breakdown .breakdown-row').blur()`);

  check(
    'AC4 分组条按模型分段，段色与趋势图逐值一致，段宽之和等于原条宽',
    segmentsMatch &&
      Math.abs(widthsSum - expectedWidth) <= 1.5 &&
      segmentState.otherSegments === 0 &&
      segmentState.otherFills > 0,
    `段数=${segmentState.segments}（期望 ${expectedSegments.length}）、颜色一致=${segmentsMatch}、` +
      `段宽和=${widthsSum.toFixed(1)}px/条宽=${expectedWidth.toFixed(1)}px、` +
      `其它列表段数=${segmentState.otherSegments}、单色条=${segmentState.otherFills}`,
  );

  check(
    'AC5 hover 与键盘 focus 都浮出分组明细，内容降序、隐藏 0 值、不撑高行',
    groupTip.open &&
      groupTip.key === splitRow?.key &&
      JSON.stringify(groupTip.models) === JSON.stringify(expectedSegments.map((segment) => segment.modelName)) &&
      tipAfterLeave.open === false &&
      focusTip.open === true &&
      JSON.stringify(focusTip.models) === JSON.stringify(groupTip.models) &&
      groupTip.pointerEvents === 'none' &&
      rowHeightOpen === segmentState.rowHeight,
    `提示=${groupTip.title || '无'}（${groupTip.models.length} 个模型，期望 ${expectedSegments.length} 个）、` +
      `移出关闭=${!tipAfterLeave.open}、focus 打开=${focusTip.open}、focus 内容一致=${JSON.stringify(focusTip.models) === JSON.stringify(groupTip.models)}、` +
      `pointer-events=${groupTip.pointerEvents || '无'}、行高=${rowHeightOpen}/${segmentState.rowHeight}`,
  );

  if (SCREENSHOT_DIR) {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const path = `${SCREENSHOT_DIR}/panel-acceptance.png`;
    await writeFile(path, Buffer.from(shot.data, 'base64'));
    console.log(`截图已保存：${path}`);
  }

  socket.close();

  const failed = results.filter((item) => item.ok === false);
  const skipped = results.filter((item) => item.ok === 'skip');
  console.log(
    `\n合计 ${results.length} 项，通过 ${results.length - failed.length - skipped.length} 项，失败 ${failed.length} 项，未覆盖 ${skipped.length} 项`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`验收失败：${error.message}`);
  process.exitCode = 1;
});
