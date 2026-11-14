import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import { formatTokens } from '../../src/web/format.ts';
import { modelColor } from '../../src/web/model-colors.ts';
import { expectRange } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE, SAMPLE_MODELS } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;
/** 0.4 不透明度画在透明画布上，alpha 为 102（0.4 × 255）。 */
const DIM_ALPHA = 102;
const ALPHA_TOLERANCE = 3;

interface Points {
  focusedDay: { x: number; y: number };
  sameSeriesOtherDay: { x: number; y: number };
  otherSeries: { x: number; y: number };
  thirdSeries: { x: number; y: number };
}

async function readPoints(panel: PanelPage): Promise<Points> {
  return {
    focusedDay: await panel.canvasPointOf(modelColor(SAMPLE_MODELS.deepseek), 'top'),
    sameSeriesOtherDay: await panel.canvasPointOf(modelColor(SAMPLE_MODELS.deepseek), 'bottom'),
    otherSeries: await panel.canvasPointOf(modelColor(SAMPLE_MODELS.hy4), 'bottom'),
    thirdSeries: await panel.canvasPointOf(modelColor(SAMPLE_MODELS.glm), 'bottom'),
  };
}

async function alphaAt(panel: PanelPage, point: { x: number; y: number }): Promise<number> {
  const [, , , alpha] = await panel.pixelAt(point);
  return alpha;
}

test.describe('hover 聚焦', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  for (const tab of ['token', 'credit'] as const) {
    test(`AC1 ${tab} 图按系列减淡到 0.4，聚焦系列跨日期保持 1.0，移出恢复`, async () => {
      if (tab === 'credit') {
        await panel.switchTab('credit');
      }
      const points = await readPoints(panel);
      expect(await alphaAt(panel, points.otherSeries), '基线不透明').toBe(255);

      await panel.hoverCanvasPoint(points.focusedDay);
      expect(await alphaAt(panel, points.sameSeriesOtherDay), '聚焦系列其它日期').toBe(255);
      expect(
        await alphaAt(panel, points.otherSeries),
        '非聚焦系列减淡到 0.4',
      ).toBeGreaterThanOrEqual(DIM_ALPHA - ALPHA_TOLERANCE);
      expect(await alphaAt(panel, points.otherSeries)).toBeLessThanOrEqual(
        DIM_ALPHA + ALPHA_TOLERANCE,
      );
      expect(await alphaAt(panel, points.thirdSeries), '第三个系列同样减淡').toBeLessThanOrEqual(
        DIM_ALPHA + ALPHA_TOLERANCE,
      );

      await panel.moveAway();
      for (const point of Object.values(points)) {
        expect(await alphaAt(panel, point), '移出后恢复 1.0').toBe(255);
      }
    });
  }

  test('AC2 趋势图 tooltip 跟随聚焦，日期行与无数据不受影响', async () => {
    const expectation = expectRange(FROM, TO);
    const points = await readPoints(panel);
    await panel.hoverCanvasPoint(points.focusedDay);

    const tip = await panel.trendTooltipState();
    expect(tip.date).toBe('2026-11-12');
    const focusedName = expectation.dayRows('2026-11-12', 'tokens')[0]?.name;
    expect(tip.rows.map((row) => row.text.split('：')[0])).toEqual([focusedName]);
    expect(tip.rows[0]?.opacity, '聚焦行 1.0').toBe('1');
    expect(
      await panel.page.locator('.trend-tip-date').evaluate((node) => getComputedStyle(node).opacity),
      '日期行 1.0',
    ).toBe('1');

    // 空白类目：只有日期与「无数据」，没有任何模型行
    await panel.quick('sevenDays');
    await panel.hoverAxisIndex(3, 7);
    expect(await panel.trendTooltipLines()).toEqual(['2026-11-11', '无数据']);
    expect(await panel.page.locator('.trend-tip-row').count(), '无数据日没有模型行').toBe(0);

    // 图例不产生模型级聚焦：样本系列的 alpha 全部保持不透明
    await panel.hoverLegend();
    expect(await alphaAt(panel, points.otherSeries), '图例不触发减淡').toBe(255);
    expect(await alphaAt(panel, points.thirdSeries), '图例不触发减淡').toBe(255);
  });

  test('AC2 聚焦到多模型日时非聚焦行 0.4、其它行 1.0，移出后全部 1.0', async () => {
    const points = await readPoints(panel);
    await panel.hoverCanvasPoint(points.otherSeries);
    const focused = await panel.trendTooltipState();
    const opacities = focused.rows.map((row) => row.opacity);
    expect(opacities.filter((value) => value === '1')).toHaveLength(1);
    expect(opacities.filter((value) => value === '0.4').length).toBeGreaterThan(0);

    await panel.moveAway();
    await panel.hoverChartBlank();
    const unfocused = await panel.trendTooltipState();
    expect(unfocused.rows.length, '空白区仍有当日模型行').toBeGreaterThan(0);
    expect(unfocused.rows.every((row) => row.opacity === '1'), '空白区悬浮全部 1.0').toBe(true);
  });

  test('AC2 hover 价格比率折线时只高亮比率行，柱段与模型行同步减淡', async () => {
    const points = await readPoints(panel);
    await panel.hoverRatioLine();

    const tip = await panel.trendTooltipState();
    expect(tip.ratioRows.length, '当天存在比率行').toBeGreaterThan(0);
    expect(tip.ratioRows.every((row) => row.opacity === '1'), '只有比率行常态').toBe(true);
    expect(tip.rows.length, '当天存在模型行').toBeGreaterThan(0);
    expect(tip.rows.every((row) => row.opacity === '0.4'), '模型行全部减淡').toBe(true);
    expect(await alphaAt(panel, points.otherSeries), '柱系列同步减淡').toBeLessThanOrEqual(
      DIM_ALPHA + ALPHA_TOLERANCE,
    );

    await panel.hoverBarOnRatioDay();
    const barTip = await panel.trendTooltipState();
    expect(barTip.ratioRows.length, '同一天仍有比率行').toBeGreaterThan(0);
    expect(
      barTip.ratioRows.every((row) => row.opacity === '0.4'),
      '聚焦柱段时比率行减淡',
    ).toBe(true);
    expect(barTip.rows.some((row) => row.opacity === '1'), '聚焦的模型行常态').toBe(true);

    await panel.hoverChartBlank();
    const restored = await panel.trendTooltipState();
    expect(
      [...restored.rows, ...restored.ratioRows].every((row) => row.opacity === '1'),
      '移出后全部恢复 1.0',
    ).toBe(true);
  });

  test('AC3 分组条按段减淡，极窄段可命中且视觉段宽与条长不变', async () => {
    const expectation = expectRange(FROM, TO);
    const segments = expectation.groupRows('tokens')[0]?.segments ?? [];
    expect(segments.length).toBe(4);
    const narrowIndex = segments.length - 1;

    const before = await panel.segments('按分组');
    await panel.hoverSegmentZone('按分组', 0, narrowIndex);

    const after = await panel.segments('按分组');
    expect(after.count, '段集合不变').toBe(before.count);
    expect(after.colors, '段色不变').toEqual(before.colors);
    expect(
      after.widths.every((width, index) => Math.abs(width - (before.widths[index] ?? 0)) < 0.5),
      '视觉段宽不变',
    ).toBe(true);
    expect(Math.abs(after.barWidth - before.barWidth), '条长不变').toBeLessThan(0.5);

    const opacities = await panel.page
      .locator('.panel.breakdown .breakdown-segment')
      .evaluateAll((nodes) =>
        nodes.slice(0, 4).map((node) => `${(node as HTMLElement).dataset.model}:${getComputedStyle(node).opacity}`),
      );
    expect(opacities[narrowIndex]).toBe(`${segments[narrowIndex]?.key}:1`);
    for (const [index, entry] of opacities.entries()) {
      if (index !== narrowIndex) {
        expect(entry.endsWith(':0.4'), '同条其它段减淡').toBe(true);
      }
    }

    const tip = await panel.rowTooltipState();
    expect(tip.rowOpacities.filter((value) => value === '1'), '浮层只有一行常态').toHaveLength(1);
    expect(tip.models[tip.rowOpacities.indexOf('1')]).toBe(segments[narrowIndex]?.name);

    await panel.moveAway();
    const restored = await panel.page
      .locator('.panel.breakdown .breakdown-segment')
      .evaluateAll((nodes) => nodes.slice(0, 4).map((node) => getComputedStyle(node).opacity));
    expect(restored).toEqual(['1', '1', '1', '1']);
  });

  test('AC3 极窄段命中区互不重叠且覆盖色段总宽', async () => {
    const state = await panel.segments('按分组');
    expect(state.hitZones.length, '每段一个命中区').toBe(state.count);

    const zones = [...state.hitZones].sort((left, right) => left.left - right.left);
    for (let index = 1; index < zones.length; index += 1) {
      const previous = zones[index - 1];
      const current = zones[index];
      const previousRight = (previous?.left ?? 0) + (previous?.width ?? 0);
      expect(Math.abs((current?.left ?? 0) - previousRight), '命中区首尾相接').toBeLessThan(0.5);
    }

    const expectation = expectRange(FROM, TO);
    const narrowModel = expectation.groupRows('tokens')[0]?.segments.at(-1)?.key ?? '';
    const narrowVisual = state.widths[state.count - 1] ?? 0;
    const narrowZone = state.hitZones.find((zone) => zone.model === narrowModel);
    expect(narrowVisual, '样本存在极窄段').toBeLessThan(3);
    expect(narrowZone?.width, '极窄段最小命中宽度').toBeGreaterThanOrEqual(7.5);
    expect(zones.every((zone) => zone.width >= 7.5), '每个命中区都不小于阈值').toBe(true);

    const hitSum = zones.reduce((sum, zone) => sum + zone.width, 0);
    const visualSum = state.widths.reduce((sum, width) => sum + width, 0);
    expect(Math.abs(hitSum - visualSum), '命中区总宽等于色段总宽').toBeLessThan(1.5);
  });

  test('AC4 浮层随段聚焦，行内非段区域与键盘 focus 不产生聚焦', async () => {
    const expectation = expectRange(FROM, TO);
    const segments = expectation.groupRows('tokens')[0]?.segments ?? [];

    await panel.hoverSegmentZone('按分组', 0, 0);
    const focused = await panel.rowTooltipState();
    expect(focused.rowOpacities[0], '对应模型行 1.0').toBe('1');
    expect(focused.rowOpacities.slice(1).every((value) => value === '0.4'), '其它行 0.4').toBe(true);
    expect(focused.models, '内容与降序不变').toEqual(segments.map((segment) => segment.name));
    expect(focused.pointerEvents).toBe('none');

    await panel.hoverRow('按分组', 0);
    const rowHover = await panel.rowTooltipState();
    expect(rowHover.open).toBe(true);
    expect(rowHover.rowOpacities.every((value) => value === '1'), '行内非段区域全部常态').toBe(
      true,
    );

    await panel.moveAway();
    await panel.focusRow('按分组', 0);
    const keyboard = await panel.rowTooltipState();
    expect(keyboard.open, '键盘 focus 浮出提示').toBe(true);
    expect(keyboard.rowOpacities.every((value) => value === '1'), '键盘 focus 不产生聚焦').toBe(
      true,
    );
  });

  test('AC5 四处减淡强度同为 0.4，且不随模型色值变化', async () => {
    // 分组条 + 分组浮层
    await panel.hoverSegmentZone('按分组', 0, 0);
    const listOpacities = await panel.page
      .locator('.panel.breakdown .breakdown-segment')
      .evaluateAll((nodes) => nodes.slice(0, 4).map((node) => getComputedStyle(node).opacity));
    const tip = await panel.rowTooltipState();
    const dimmed = listOpacities.filter((value) => value !== '1');
    expect(dimmed.length).toBeGreaterThan(0);
    expect(new Set(dimmed), '分组条只有一个强度').toEqual(new Set(['0.4']));
    expect(new Set(tip.rowOpacities.filter((value) => value !== '1')), '浮层同一强度').toEqual(
      new Set(['0.4']),
    );

    // 趋势图系列 + 趋势图 tooltip
    await panel.moveAway();
    const points = await readPoints(panel);
    await panel.hoverCanvasPoint(points.focusedDay);
    const ratio = (await alphaAt(panel, points.otherSeries)) / 255;
    expect(ratio).toBeGreaterThan(0.38);
    expect(ratio).toBeLessThan(0.42);
    await panel.hoverBarOnRatioDay();
    const trendRows = await panel.trendTooltipState();
    expect(new Set(trendRows.rows.map((row) => row.opacity)), '趋势图 tooltip 同一强度').toEqual(
      new Set(['1', '0.4']),
    );
    expect(trendRows.ratioRows.length, '当天存在比率行').toBeGreaterThan(0);
    expect(
      trendRows.ratioRows.every((row) => row.opacity === '0.4'),
      '聚焦柱段时比率行随非聚焦行减淡',
    ).toBe(true);
  });

  test('AC6 图表与列表互不联动，切 tab 后不残留聚焦', async () => {
    const points = await readPoints(panel);

    await panel.hoverCanvasPoint(points.focusedDay);
    const listWhileChartFocused = await panel.page
      .locator('.panel.breakdown .breakdown-segment')
      .evaluateAll((nodes) => nodes.slice(0, 4).map((node) => getComputedStyle(node).opacity));
    expect(listWhileChartFocused.every((value) => value === '1'), '图表聚焦不影响列表').toBe(true);

    await panel.hoverSegmentZone('按分组', 0, 0);
    expect(await alphaAt(panel, points.otherSeries), '列表聚焦不影响图表').toBe(255);

    await panel.switchTab('credit');
    await panel.switchTab('token');
    const restored = await panel.page
      .locator('.panel.breakdown .breakdown-segment')
      .evaluateAll((nodes) => nodes.slice(0, 4).map((node) => getComputedStyle(node).opacity));
    expect(restored.every((value) => value === '1'), '切 tab 后无残留聚焦').toBe(true);
    for (const point of Object.values(points)) {
      expect(await alphaAt(panel, point), '切 tab 后图表无残留减淡').toBe(255);
    }
  });

  test('AC6 改筛选与刷新后不残留聚焦', async () => {
    const points = await readPoints(panel);
    await panel.hoverCanvasPoint(points.focusedDay);
    expect(await alphaAt(panel, points.otherSeries)).toBeLessThan(255);

    await panel.quick('sevenDays');
    expect(await alphaAt(panel, points.otherSeries), '改筛选后清除聚焦').toBe(255);
    await panel.quick('threeDays');

    const refreshed = await readPoints(panel);
    await panel.hoverCanvasPoint(refreshed.focusedDay);
    expect(await alphaAt(panel, refreshed.otherSeries)).toBeLessThan(255);

    const response = panel.page.waitForResponse(
      (item) => item.url().includes('/api/refresh') && item.status() === 200,
    );
    // 用键盘触发刷新，指针留在柱段上，才能验证刷新本身会清除聚焦
    await panel.page.getByRole('button', { name: '刷新数据' }).focus();
    await panel.page.keyboard.press('Enter');
    await response;
    await expect(panel.page.locator('.refresh-strip')).toContainText('扫描');
    for (const point of Object.values(refreshed)) {
      expect(await alphaAt(panel, point), '刷新后清除聚焦').toBe(255);
    }
  });

  test('AC7 聚焦功能不影响既有呈现规则', async ({ page }) => {
    const expectation = expectRange(FROM, TO);

    await expect(panel.rows('按分组')).toHaveCount(8);
    await expect(panel.breakdownPanel('按分组').locator('.panel-meta')).toHaveText('10 项');

    const others = await page.evaluate(() =>
      [...document.querySelectorAll('.panel.breakdown')]
        .filter((node) => node.querySelector('h3')?.textContent !== '按分组')
        .map((node) => ({
          segments: node.querySelectorAll('.breakdown-segment').length,
          zones: node.querySelectorAll('.breakdown-hit-zone').length,
          fills: node.querySelectorAll('.breakdown-fill').length,
        })),
    );
    for (const other of others) {
      expect(other.segments, '按对话 / 按模型不分段').toBe(0);
      expect(other.zones, '按对话 / 按模型没有命中区').toBe(0);
      expect(other.fills).toBeGreaterThan(0);
    }

    await expect(panel.metric('合计 Token')).toHaveText(expectation.text.totalTokens);
    await expect(panel.metricSuffix('缓存命中')).toHaveText(expectation.text.hitRate);

    const toggle = page.locator('.table-toggle').first();
    await toggle.click();
    await expect(page.locator('.table-body tbody tr')).toHaveCount(expectation.requests.length);
    await expect(page.locator('.table-body th[aria-sort=descending]')).toHaveCount(1);
    await toggle.click();

    const points = await readPoints(panel);
    await panel.hoverCanvasPoint(points.otherSeries);
    const tip = await panel.trendTooltipState();
    expect(tip.rows.map((row) => row.text.split('：')[0])).not.toContain('Kimi-K3.1-Pro');
    expect(tip.rows[0]?.text).toContain(`Hy4：${formatTokens(200)}`);
  });
});
