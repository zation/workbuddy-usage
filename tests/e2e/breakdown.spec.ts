import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import { formatTokens } from '../../src/web/format.ts';
import { expectRange, normalizeColor, rgbOf } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;

test.describe('分组条与明细提示', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  test('AC4 分组条按模型分段，段色与趋势图一致，段宽之和等于原条宽', async ({ page }) => {
    const expectation = expectRange(FROM, TO);
    const firstGroup = expectation.groupRows('tokens')[0];
    expect(firstGroup, '样本首行分组存在').toBeTruthy();
    const expectedSegments = firstGroup?.segments ?? [];
    expect(expectedSegments.length, '首行分组含多个模型段').toBeGreaterThan(1);

    const state = await panel.segments('按分组');
    expect(state.count).toBe(expectedSegments.length);
    expect(state.colors.map(normalizeColor)).toEqual(
      expectedSegments.map((segment) => normalizeColor(rgbOf(segment.color))),
    );

    const expectedWidth = expectation.groupShare(firstGroup?.key ?? '', 'tokens') * state.barWidth;
    const widthsSum = state.widths.reduce((sum, width) => sum + width, 0);
    expect(Math.abs(widthsSum - expectedWidth), '段宽之和等于分段前的条宽').toBeLessThanOrEqual(1.5);

    const others = await page.evaluate(() =>
      [...document.querySelectorAll('.panel.breakdown')]
        .filter((node) => node.querySelector('h3')?.textContent !== '按分组')
        .map((node) => ({
          segments: node.querySelectorAll('.breakdown-segment').length,
          fills: node.querySelectorAll('.breakdown-fill').length,
        })),
    );
    expect(others).toHaveLength(2);
    for (const other of others) {
      expect(other.segments, '其它列表不分段').toBe(0);
      expect(other.fills, '其它列表保持单色条').toBeGreaterThan(0);
    }
  });

  test('AC5 hover 与键盘 focus 都浮出分组明细，内容降序、隐藏 0 值、不撑高行', async () => {
    const expectation = expectRange(FROM, TO);
    const firstGroup = expectation.groupRows('tokens')[0];
    const expectedSegments = firstGroup?.segments ?? [];

    const boxBefore = await panel.rows('按分组').first().boundingBox();
    await panel.hoverRow('按分组', 0);

    const tip = await panel.rowTooltipState();
    expect(tip.open).toBe(true);
    expect(tip.title).toBe(firstGroup?.name);
    expect(tip.key).toBe(firstGroup?.key);
    expect(tip.total).toBe(formatTokens(firstGroup?.tokens ?? 0));
    expect(tip.models).toEqual(expectedSegments.map((segment) => segment.name));
    expect(tip.values).toEqual(expectedSegments.map((segment) => formatTokens(segment.tokens)));
    expect(tip.models).not.toContain('Kimi-K3.1-Pro');
    expect(tip.pointerEvents).toBe('none');

    const boxWhileOpen = await panel.rows('按分组').first().boundingBox();
    expect(boxWhileOpen?.height, '浮层不撑高行').toBe(boxBefore?.height);

    await panel.moveAway();
    expect((await panel.rowTooltipState()).open, '移出后关闭').toBe(false);

    await panel.focusRow('按分组', 0);
    const focused = await panel.rowTooltipState();
    expect(focused.open, '键盘 focus 浮出提示').toBe(true);
    expect(focused.models).toEqual(tip.models);
  });
});
