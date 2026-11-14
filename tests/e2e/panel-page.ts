import { expect } from '@playwright/test';
import type { Locator, Page, Request } from '@playwright/test';
import { FROZEN_NOW_MS } from './sample.ts';
import type { Metric } from './expectations.ts';

export type Tab = 'token' | 'credit';
export type FilterId = 'group' | 'session' | 'model';

export interface TimeState {
  from: string;
  to: string;
  pressed: string[];
  buttons: string[];
}

export interface RowTooltipState {
  open: boolean;
  title: string;
  total: string;
  key: string;
  models: string[];
  values: string[];
  dotColors: string[];
  pointerEvents: string;
  empty: boolean;
  rowOpacities: string[];
}

export interface TrendTooltipState {
  text: string;
  date: string;
  rows: Array<{ text: string; opacity: string }>;
}

export interface SegmentState {
  count: number;
  colors: string[];
  widths: number[];
  barWidth: number;
  hitZones: Array<{ model: string; left: number; width: number; top: number; height: number }>;
}

/** 面板页面对象：定位器与交互集中在此，用例只描述断言。 */
export class PanelPage {
  readonly page: Page;
  readonly requests: Request[] = [];

  constructor(page: Page) {
    this.page = page;
    page.on('request', (request) => this.requests.push(request));
  }

  get tabs(): Locator {
    return this.page.locator('[role=tab]');
  }

  get tabPanels(): Locator {
    return this.page.locator('[role=tabpanel]');
  }

  get chart(): Locator {
    return this.page.locator('.chart');
  }

  get trendTooltip(): Locator {
    return this.page.locator('.chart .trend-tooltip, .chart div[style*="position: absolute"]').first();
  }

  get rowTooltip(): Locator {
    return this.page.locator('.panel.breakdown .breakdown-tooltip');
  }

  get errorText(): Locator {
    return this.page.locator('.filter-error');
  }

  async open(): Promise<void> {
    // 只冻结 Date.now：不接管定时器与动画，避免影响 ECharts 渲染与 React 调度
    await this.page.clock.setFixedTime(FROZEN_NOW_MS);
    await this.page.goto('/');
    await expect(this.tabs).toHaveCount(2);
    await expect(this.page.locator('.metric-card').first().locator('.metric-value')).not.toHaveText(
      '—',
    );
  }

  async switchTab(tab: Tab): Promise<void> {
    await this.page.locator(`#${tab}-tab`).click();
    await expect(this.page.locator(`#${tab}-tab`)).toHaveAttribute('aria-selected', 'true');
  }

  panel(tab: Tab): Locator {
    return this.page.locator(`#${tab}-module`);
  }

  metric(label: string): Locator {
    return this.metricCard(label).locator('.metric-value');
  }

  /** 指标数值本身（不含后缀），与卡片渲染的文本节点一致。 */
  async metricValue(label: string): Promise<string> {
    return this.metric(label).evaluate((node) => node.firstChild?.textContent?.trim() ?? '');
  }

  metricSuffix(label: string): Locator {
    return this.metricCard(label).locator('.metric-suffix');
  }

  private metricCard(label: string): Locator {
    return this.page
      .locator('.metric-card')
      .filter({ has: this.page.locator('.metric-label', { hasText: label }) })
      .first();
  }

  /** 等一次筛选变更落地：五个查询都会重取，等齐其中三类再断言。 */
  async applyFilter(action: () => Promise<void>): Promise<void> {
    const summary = this.page.waitForResponse(
      (response) => response.url().includes('/api/summary') && response.status() === 200,
    );
    const series = this.page.waitForResponse(
      (response) => response.url().includes('/api/timeseries') && response.status() === 200,
    );
    const segments = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/breakdown') &&
        response.url().includes('split=model') &&
        response.status() === 200,
    );
    await action();
    await Promise.all([summary, series, segments]);
  }

  async quick(key: string): Promise<void> {
    await this.applyFilter(() => this.page.locator(`[data-quick=${key}]`).click());
    await expect(this.page.locator(`[data-quick=${key}]`)).toHaveAttribute('aria-pressed', 'true');
  }

  async reset(): Promise<void> {
    const button = this.page.getByRole('button', { name: '重置' });
    if (await button.isDisabled()) {
      return;
    }
    await this.applyFilter(() => button.click());
    await expect(button).toBeDisabled();
  }

  async openDateRange(): Promise<void> {
    if ((await this.page.locator('#custom-date-range').getAttribute('hidden')) === null) {
      return;
    }
    await this.page.locator('[data-more]').click();
    await expect(this.page.locator('#custom-date-range')).toBeVisible();
  }

  async timeState(): Promise<TimeState> {
    const inputs = this.page.locator('.date-range input[type=date]');
    const pressed = await this.page
      .locator('[data-quick][aria-pressed=true]')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.quick ?? ''));
    return {
      from: await inputs.nth(0).inputValue(),
      to: await inputs.nth(1).inputValue(),
      pressed,
      buttons: await this.page
        .locator('[data-quick]')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.quick ?? '')),
    };
  }

  private async fillDate(index: number, value: string): Promise<void> {
    const input = this.page.locator('.date-range input[type=date]').nth(index);
    if ((await input.inputValue()) === value) {
      return;
    }
    await this.applyFilter(() => input.fill(value));
  }

  /** 先写不会越界的一端，避免中间态被前端拦下而留下错误提示。 */
  async setRange(from: string, to: string): Promise<void> {
    await this.openDateRange();
    const current = await this.timeState();
    if (current.to && from > current.to) {
      await this.fillDate(1, to);
      await this.fillDate(0, from);
    } else {
      await this.fillDate(0, from);
      await this.fillDate(1, to);
    }
    await expect(this.page.locator('.date-range input[type=date]').nth(0)).toHaveValue(from);
    await expect(this.page.locator('.date-range input[type=date]').nth(1)).toHaveValue(to);
  }

  filterTrigger(id: FilterId): Locator {
    return this.page.locator(`#filter-${id}`);
  }

  selectRoot(id: FilterId): Locator {
    return this.page
      .locator('.select')
      .filter({ has: this.page.locator(`#filter-${id}`) })
      .first();
  }

  private filterOption(id: FilterId, value: string): Locator {
    return this.selectRoot(id).locator(`.select-option[data-value="${value}"]`);
  }

  async openFilter(id: FilterId): Promise<void> {
    if ((await this.filterTrigger(id).getAttribute('aria-expanded')) === 'true') {
      return;
    }
    await this.filterTrigger(id).click();
    await expect(this.filterTrigger(id)).toHaveAttribute('aria-expanded', 'true');
  }

  async selectFilter(id: FilterId, value: string): Promise<void> {
    await this.openFilter(id);
    await this.applyFilter(() => this.filterOption(id, value).click());
    await expect(this.filterTrigger(id)).toHaveAttribute('data-value', value);
  }

  async filterValue(id: FilterId): Promise<string> {
    return (await this.filterTrigger(id).getAttribute('data-value')) ?? '';
  }

  /** 下拉当前渲染出的选项值；首项为空值项。 */
  async filterOptions(id: FilterId): Promise<string[]> {
    await this.openFilter(id);
    const options = await this.selectRoot(id)
      .locator('.select-option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.value ?? ''));
    await this.page.keyboard.press('Escape');
    return options;
  }

  breakdownPanel(title: string): Locator {
    return this.page
      .locator('.panel.breakdown')
      .filter({ has: this.page.locator('h3', { hasText: title }) })
      .first();
  }

  breakdownPanels(): Locator {
    return this.page.locator('.panel.breakdown');
  }

  rows(title: string): Locator {
    return this.breakdownPanel(title).locator('.breakdown-row');
  }

  async rowTitle(title: string, index: number): Promise<string> {
    return (await this.rows(title).nth(index).getAttribute('title')) ?? '';
  }

  async segments(title: string, rowIndex = 0): Promise<SegmentState> {
    const row = this.rows(title).nth(rowIndex);
    const bar = row.locator('.breakdown-bar');
    return bar.evaluate((node) => {
      const segments = [...node.querySelectorAll('.breakdown-segment')];
      const zones = [...node.querySelectorAll('.breakdown-hit-zone')];
      const rect = node.getBoundingClientRect();
      return {
        count: segments.length,
        colors: segments.map((item) => getComputedStyle(item).backgroundColor),
        widths: segments.map((item) => item.getBoundingClientRect().width),
        barWidth: rect.width,
        hitZones: zones.map((zone) => {
          const box = zone.getBoundingClientRect();
          return {
            model: (zone as HTMLElement).dataset.model ?? '',
            left: box.left - rect.left,
            width: box.width,
            top: box.top - rect.top,
            height: box.height,
          };
        }),
      };
    });
  }

  /** 逐段 hover 的坐标：优先用命中区，其次用视觉色段。 */
  private async segmentPoint(
    title: string,
    rowIndex: number,
    selector: 'zone' | 'segment',
    index: number,
  ): Promise<{ x: number; y: number }> {
    const target = this.rows(title)
      .nth(rowIndex)
      .locator(selector === 'zone' ? '.breakdown-hit-zone' : '.breakdown-segment')
      .nth(index);
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(`取不到第 ${index} 个色段的位置`);
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async hoverSegmentZone(title: string, rowIndex: number, index: number): Promise<void> {
    const point = await this.segmentPoint(title, rowIndex, 'zone', index);
    await this.page.mouse.move(point.x, point.y);
  }

  async hoverSegment(title: string, rowIndex: number, index: number): Promise<void> {
    const point = await this.segmentPoint(title, rowIndex, 'segment', index);
    await this.page.mouse.move(point.x, point.y);
  }

  /** hover 行的名称区，避免指针落在数值条上而触发段级状态。 */
  async hoverRow(title: string, index = 0): Promise<void> {
    await this.rows(title).nth(index).locator('.breakdown-name').hover();
  }

  async focusRow(title: string, index = 0): Promise<void> {
    await this.rows(title).nth(index).focus();
  }

  async rowTooltipState(): Promise<RowTooltipState> {
    const tip = this.rowTooltip;
    if ((await tip.count()) === 0) {
      return {
        open: false,
        title: '',
        total: '',
        key: '',
        models: [],
        values: [],
        dotColors: [],
        pointerEvents: '',
        empty: false,
        rowOpacities: [],
      };
    }
    const items = tip.locator('.breakdown-tooltip-list li');
    const texts = await items.evaluateAll((nodes) =>
      nodes.map((node) => ({
        model: node.querySelector('.breakdown-tooltip-model')?.textContent ?? '',
        value: node.querySelector('.breakdown-tooltip-value')?.textContent ?? '',
        color: node.querySelector('.model-dot')
          ? getComputedStyle(node.querySelector('.model-dot') as Element).backgroundColor
          : '',
        opacity: getComputedStyle(node).opacity,
      })),
    );
    return {
      open: true,
      title: (await tip.locator('.breakdown-tooltip-title').textContent()) ?? '',
      total: (await tip.locator('.breakdown-tooltip-total').textContent()) ?? '',
      key: (await tip.locator('.breakdown-tooltip-key').textContent()) ?? '',
      models: texts.map((item) => item.model),
      values: texts.map((item) => item.value),
      dotColors: texts.map((item) => item.color),
      pointerEvents: await tip.evaluate((node) => getComputedStyle(node).pointerEvents),
      empty: (await tip.locator('.breakdown-tooltip-empty').count()) > 0,
      rowOpacities: texts.map((item) => item.opacity),
    };
  }

  async chartBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.chart.locator('canvas').first().boundingBox();
    if (!box) {
      throw new Error('趋势图没有 canvas');
    }
    return box;
  }

  /** 按类目均分推算坐标后 hover，命中与否由 tooltip 文本确认。 */
  async hoverCategory(index: number, count: number): Promise<void> {
    const box = await this.chartBox();
    await this.page.mouse.move(
      box.x + (box.width * (index + 0.5)) / count,
      box.y + box.height * 0.8,
    );
  }

  async hoverChartBlank(): Promise<void> {
    const box = await this.chartBox();
    await this.page.mouse.move(box.x + box.width * 0.5, box.y + 4);
  }

  /**
   * tooltip 按 `<br/>` 分行，innerText 会把行还原成换行。
   * 浮层内容在无柱段的类目上异步落地（showDelay + 动画帧），读到连续两次一致才算稳定。
   */
  async trendTooltipLines(): Promise<string[]> {
    const tip = this.trendTooltip;
    await expect(tip).toBeVisible();
    const read = async (): Promise<string[]> => {
      const text = await tip.innerText();
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    };
    let previous = await read();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await this.page.waitForTimeout(60);
      const current = await read();
      if (current.length > 0 && current.join('\n') === previous.join('\n')) {
        return current;
      }
      previous = current;
    }
    return previous;
  }

  async trendTooltipDate(): Promise<string> {
    return (await this.trendTooltipLines())[0] ?? '';
  }

  /** canvas 绘制没有可等待的事件，只能短间隔重试到出图。 */
  private async pollCanvas<T>(read: () => Promise<T | null>): Promise<T> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const value = await read();
      if (value !== null) {
        return value;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error('趋势图尚未完成绘制');
  }

  /**
   * 日期轴类目均分在 x 轴线上。x 轴线颜色为 `#e6e8eb`，会被柱段遮住中断，
   * 因此取该颜色在画布下半部的最左与最右像素作为绘图区边界，而不是最长连续段。
   */
  async axisBounds(): Promise<{ left: number; right: number }> {
    return this.pollCanvas(async () =>
      this.chart.locator('canvas').first().evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
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
              data[index] === 230 &&
              data[index + 1] === 232 &&
              data[index + 2] === 235 &&
              data[index + 3] === 255
            ) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
          }
        }
        return right - left > 100 ? { left, right } : null;
      }),
    );
  }

  /**
   * 按类目序号 hover：`count` 为当前区间的天数。先落到别处再落目标，且落点连发两次——
   * 单次指针事件只清掉上一类目的 hover，第二次才让浮层按新类目出内容。
   */
  async hoverAxisIndex(index: number, count: number): Promise<void> {
    const box = await this.chartBox();
    const bounds = await this.axisBounds();
    const step = (bounds.right - bounds.left) / count;
    const x = box.x + bounds.left + (index + 0.5) * step;
    const y = box.y + box.height * 0.5;
    await this.page.mouse.move(box.x + 4, box.y + 4);
    await this.page.mouse.move(x, y);
    await this.page.waitForTimeout(80);
    await this.page.mouse.move(x, y);
  }

  async moveAway(): Promise<void> {
    await this.page.mouse.move(2, 2);
  }

  async trendTooltipState(): Promise<TrendTooltipState> {
    const tip = this.trendTooltip;
    const rows = await tip.locator('.trend-tip-row').evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: (node as HTMLElement).textContent ?? '',
        opacity: getComputedStyle(node).opacity,
      })),
    );
    return {
      text: (await tip.textContent()) ?? '',
      date: (await tip.locator('.trend-tip-date').textContent()) ?? '',
      rows,
    };
  }

  /**
   * 在 canvas 上找某一颜色的连续像素段，返回该段中点（CSS 像素，dpr 固定为 1）。
   * 跳过底部图例区域并要求连续 10 像素以上：图例色点直径 8px，不会被误判成柱段。
   */
  async canvasPointOf(color: string): Promise<{ x: number; y: number }> {
    const point = await this.pollCanvas(async () =>
      this.chart.locator('canvas').first().evaluate((node, target) => {
        const canvas = node as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context) {
          return null;
        }
        const hex = /^#([0-9a-f]{6})$/i.exec(target);
        if (!hex) {
          return null;
        }
        const value = Number.parseInt(hex[1] as string, 16);
        const want = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
        const { width, height } = canvas;
        const data = context.getImageData(0, 0, width, height).data;
        const maxY = height - 40;
        for (let y = 0; y < maxY; y += 1) {
          let run = 0;
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const match =
              data[index] === want[0] &&
              data[index + 1] === want[1] &&
              data[index + 2] === want[2] &&
              data[index + 3] === 255;
            run = match ? run + 1 : 0;
            if (run === 10) {
              return { x: x - 4, y };
            }
          }
        }
        return null;
      }, color),
    );
    if (!point) {
      throw new Error(`canvas 上找不到颜色 ${color} 的色块`);
    }
    return point;
  }

  async pixelAt(point: { x: number; y: number }): Promise<[number, number, number, number]> {
    return this.chart.locator('canvas').first().evaluate((node, target) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('取不到 canvas 2d 上下文');
      }
      const data = context.getImageData(target.x, target.y, 1, 1).data;
      return [data[0], data[1], data[2], data[3]] as [number, number, number, number];
    }, point);
  }

  async hoverCanvasPoint(point: { x: number; y: number }): Promise<void> {
    const box = await this.chartBox();
    await this.page.mouse.move(box.x + 4, box.y + 4);
    await this.page.mouse.move(box.x + point.x, box.y + point.y);
    await this.page.waitForTimeout(80);
    await this.page.mouse.move(box.x + point.x, box.y + point.y);
  }

  requestsMatching(pathname: string): string[] {
    return this.requests
      .map((request) => request.url())
      .filter((url) => {
        try {
          return new URL(url).pathname === pathname;
        } catch {
          return false;
        }
      });
  }

  async api<T>(path: string): Promise<T> {
    const response = await this.page.request.get(path);
    expect(response.status(), `${path} 状态码`).toBe(200);
    return (await response.json()) as T;
  }

  async apiStatus(path: string): Promise<{ status: number; body: { error?: string } }> {
    const response = await this.page.request.get(path);
    return { status: response.status(), body: (await response.json()) as { error?: string } };
  }

  metricTab(metric: Metric): Tab {
    return metric === 'tokens' ? 'token' : 'credit';
  }
}
