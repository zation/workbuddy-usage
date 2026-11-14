import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import { expectRange, normalizeColor, rgbOf } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE, SAMPLE_MODELS } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;

const TOKEN_VALUE = /^-?[\d,]+(\.\d)?[KMB]?$/u;
const TOKEN_TOOLTIP_LINE = /：-?[\d,]+(\.\d)?[KMB]?$/u;
const TOKEN_UNIT_SUFFIX = /[KMB]$/u;
const CREDIT_VALUE = /^\d[\d,]*\.\d{2}$/u;
const CREDIT_TOOLTIP_LINE = /：\d[\d,]*\.\d{2}$/u;

test.describe('数值、单位与配色', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  test('AC5 token 使用 K/M/B、页面与 tooltip 无中文单位', async ({ page }) => {
    const expectation = expectRange(FROM, TO);
    for (const label of ['合计 Token', '输入', '输出', '缓存命中']) {
      const value = await panel.metricValue(label);
      expect(value, `${label} 使用 K/M/B`).toMatch(TOKEN_VALUE);
    }
    expect(await panel.metricValue('合计 Token')).toBe(expectation.text.totalTokens);
    expect(await panel.metricValue('请求数')).toMatch(/^\d[\d,]*$/u);

    await page.locator('.table-toggle').first().click();
    await expect(page.locator('.table-body tbody tr')).toHaveCount(expectation.requests.length);

    const pageText = await page.evaluate(() =>
      [...document.querySelectorAll('.metric-value, .breakdown-value, .table-body td')]
        .map((node) => node.textContent ?? '')
        .join(' '),
    );
    expect(pageText).not.toContain('万');
    expect(pageText).not.toContain('亿');

    await panel.hoverAxisIndex(1, 3);
    const lines = (await panel.trendTooltipLines()).slice(1);
    // 比率行不是柱子的数值行，单独由比率用例覆盖
    const barLines = lines.filter((line) => !line.includes('费用比率'));
    expect(barLines.length).toBeGreaterThan(0);
    for (const line of barLines) {
      expect(line, 'tooltip 数值格式').toMatch(TOKEN_TOOLTIP_LINE);
    }
    expect(barLines.some((line) => TOKEN_UNIT_SUFFIX.test(line)), 'tooltip 使用 K/M/B').toBe(true);
    expect(lines.join(' ')).not.toContain('万');
    expect(lines.join(' ')).not.toContain('亿');
  });

  test('AC6 缓存命中卡显示命中率，与样本手算一致', async () => {
    const expectation = expectRange(FROM, TO);
    expect(expectation.text.hitRate).toBe('34.6%');
    await expect(panel.metric('缓存命中')).toContainText(expectation.text.cacheReadTokens);
    await expect(panel.metricSuffix('缓存命中')).toHaveText(expectation.text.hitRate);
  });

  test('AC3 拆分色段首帧即最终色，重复读取与跨筛选都不变色', async ({ page }) => {
    const expectation = expectRange(FROM, TO);
    const expected = (expectation.groupRows('tokens')[0]?.segments ?? []).map((segment) =>
      normalizeColor(rgbOf(segment.color)),
    );

    const first = await panel.segments('按分组');
    expect(first.colors.map(normalizeColor), '首帧色段即模型固定色').toEqual(expected);

    await page.waitForTimeout(1500);
    expect((await panel.segments('按分组')).colors.map(normalizeColor), '渲染稳定后不变').toEqual(
      expected,
    );

    await panel.quick('sevenDays');
    await panel.quick('threeDays');
    expect((await panel.segments('按分组')).colors.map(normalizeColor), '跨区间不变').toEqual(
      expected,
    );
  });

  test('AC4 色点跨趋势图、拆分、下拉与明细一致', async ({ page }) => {
    const expectation = expectRange(FROM, TO);
    const modelRow = panel.breakdownPanel('按模型').locator('.breakdown-row').first();
    const modelKey = (await modelRow.getAttribute('title')) ?? '';
    expect(modelKey).toBe(SAMPLE_MODELS.deepseek);
    const model = expectation.models.find((item) => item.key === modelKey);
    expect(model, '样本模型存在').toBeTruthy();
    const expectedColor = normalizeColor(rgbOf(model?.color ?? ''));
    expect(expectedColor).not.toBe('');

    const rowDot = await modelRow
      .locator('.model-dot')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(normalizeColor(rowDot), '按模型色点').toBe(expectedColor);

    await panel.openFilter('model');
    const optionDot = await panel
      .selectRoot('model')
      .locator(`.select-option[data-value="${modelKey}"] .model-dot`)
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(normalizeColor(optionDot), '下拉色点').toBe(expectedColor);
    await page.keyboard.press('Escape');

    const segmentColors = (await panel.segments('按分组')).colors.map(normalizeColor);
    expect(segmentColors, '分组色段').toContain(expectedColor);

    await page.locator('.table-toggle').first().click();
    const tableRow = page
      .locator('.table-body tbody tr')
      .filter({ has: page.locator(`td[title="${modelKey}"]`) })
      .first();
    await expect(tableRow).toHaveCount(1);
    const tableDot = await tableRow
      .locator('.model-dot')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(normalizeColor(tableDot), '明细色点').toBe(expectedColor);

    const point = await panel.canvasPointOf(model?.color ?? '');
    const pixel = await panel.pixelAt(point);
    expect(normalizeColor(`rgb(${pixel[0]},${pixel[1]},${pixel[2]})`), '趋势图柱色').toBe(
      expectedColor,
    );

    await panel.selectFilter('model', modelKey);
    const triggerDot = await panel
      .filterTrigger('model')
      .locator('.model-dot')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(normalizeColor(triggerDot), '触发按钮色点').toBe(expectedColor);
  });

  test('AC7 0 值隐藏、下拉可切换、积分刻度无 k', async () => {
    const tokenExpectation = expectRange(FROM, TO);
    const tokenOptions = (await panel.filterOptions('model')).filter((value) => value !== '');
    expect([...tokenOptions].sort()).toEqual(
      tokenExpectation
        .orderedModels('tokens')
        .map((model) => model.key)
        .sort(),
    );
    expect(tokenOptions).not.toContain(SAMPLE_MODELS.kimi);

    await panel.selectFilter('model', tokenOptions[0] ?? '');
    const afterSelect = (await panel.filterOptions('model')).filter((value) => value !== '');
    expect(afterSelect.length, '选中后选项数量不变').toBe(tokenOptions.length);
    await panel.selectFilter('model', tokenOptions[1] ?? '');
    expect(await panel.filterValue('model')).toBe(tokenOptions[1]);

    await panel.selectFilter('model', '');
    await panel.switchTab('credit');
    const creditOptions = (await panel.filterOptions('model')).filter((value) => value !== '');
    expect([...creditOptions].sort()).toEqual(
      tokenExpectation
        .orderedModels('credit')
        .map((model) => model.key)
        .sort(),
    );
    expect(creditOptions).not.toContain(SAMPLE_MODELS.mimo);
    expect(creditOptions).not.toContain(SAMPLE_MODELS.kimi);

    expect(await panel.metricValue('积分合计'), '积分两位小数').toBe(tokenExpectation.text.credit);
    expect(await panel.metricValue('积分合计')).toMatch(CREDIT_VALUE);

    await panel.hoverAxisIndex(1, 3);
    const lines = (await panel.trendTooltipLines()).slice(1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, '积分 tooltip 两位小数').toMatch(CREDIT_TOOLTIP_LINE);
    }
    expect(lines.join(' '), '积分数值不做 K/M/B 缩写').not.toMatch(/\d[KMB]/u);
    expect(lines.some((line) => line.includes('Mimo')), '积分 0 值模型不进 tooltip').toBe(false);
  });
});
