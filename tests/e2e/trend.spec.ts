import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import type { SummaryResponse, TimeseriesResponse } from '../../src/shared/types.ts';
import { formatTokens } from '../../src/web/format.ts';
import { expectRange } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE, SAMPLE_MODELS } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;
const RATIO_LABEL = 'DeepSeek 费用比率';

test.describe('趋势图与 tooltip', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  test('AC13 两张趋势图 tooltip 过滤 0 值并保留日期与「无数据」', async () => {
    for (const [tab, metric] of [
      ['token', 'tokens'],
      ['credit', 'credit'],
    ] as const) {
      if (tab === 'credit') {
        await panel.switchTab('credit');
      }
      const expectation = expectRange(FROM, TO);
      await panel.hoverAxisIndex(2, 3);
      const lines = await panel.trendTooltipLines();
      expect(lines[0], `${tab} 日期行`).toBe('2026-11-14');
      const names = lines
        .slice(1)
        .filter((line) => !line.includes(RATIO_LABEL))
        .map((line) => line.split('：')[0] ?? '');
      expect(names, `${tab} 当日模型行`).toEqual(
        expectation.dayRows('2026-11-14', metric).map((model) => model.name),
      );
      expect(lines.join(' '), `${tab} 0 值模型不出现`).not.toContain('Kimi');
    }

    await panel.quick('sevenDays');
    await panel.hoverAxisIndex(3, 7);
    expect(await panel.trendTooltipLines()).toEqual(['2026-11-11', '无数据']);
  });

  test('AC8 /api/timeseries 不含 days，近 7 天画满 7 格', async () => {
    const api = await panel.api<TimeseriesResponse>('/api/timeseries');
    expect(Object.hasOwn(api, 'days'), '响应不含 days').toBe(false);

    await panel.quick('sevenDays');
    const days = expectRange(addDays(TO, -6), TO).days;
    expect(days).toHaveLength(7);
    const dates: string[] = [];
    for (let index = 0; index < days.length; index += 1) {
      await panel.hoverAxisIndex(index, days.length);
      dates.push(await panel.trendTooltipDate());
    }
    expect(dates).toEqual(days);
  });

  test('AC9 100 天区间正常生效，101 天被前端与 API 用同一文案拦截', async ({ page }) => {
    const hundredFrom = addDays(TO, -99);
    await panel.setRange(hundredFrom, TO);
    await expect(panel.errorText).toHaveCount(0);
    await expect(panel.metric('合计 Token')).toHaveText(
      expectRange(hundredFrom, TO).text.totalTokens,
    );

    await panel.hoverAxisIndex(0, 100);
    expect(await panel.trendTooltipDate(), '100 天轴线从区间首日开始').toBe(hundredFrom);
    await panel.hoverAxisIndex(99, 100);
    expect(await panel.trendTooltipDate(), '100 天轴线到区间末日结束').toBe(TO);

    const invalidFrom = addDays(TO, -100);
    await panel.openDateRange();
    const fromInput = page.locator('.date-range input[type=date]').nth(0);
    const before = panel.requestsMatching('/api/summary').length;
    await fromInput.fill(invalidFrom);
    await expect(panel.errorText).toHaveText('时间跨度不能超过 100 天');
    await expect(fromInput).toHaveValue(hundredFrom);
    await page.waitForTimeout(300);
    expect(panel.requestsMatching('/api/summary').length, '越界区间不发请求').toBe(before);

    const tooLong = await panel.apiStatus(`/api/summary?from=${invalidFrom}&to=${TO}`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('时间跨度不能超过 100 天');

    const full = await panel.api<SummaryResponse>('/api/summary');
    expect(full.token.totalTokens).toBeGreaterThan(0);

    await panel.quick('sevenDays');
    await expect(panel.errorText).toHaveCount(0);
    expect((await panel.timeState()).from).toBe(addDays(TO, -6));
  });

  test('AC10 Token 图按 DS 数据叠加价格比率行，积分图没有', async () => {
    const expectation = expectRange(FROM, TO);
    expect(expectation.ratios.map((row) => row.date)).toEqual(['2026-11-12', '2026-11-13']);

    await panel.hoverAxisIndex(0, 3);
    expect(await panel.trendTooltipLines()).toContain(
      `${RATIO_LABEL}：${expectation.ratios[0]?.text}`,
    );

    await panel.hoverAxisIndex(1, 3);
    expect(await panel.trendTooltipLines()).toContain(
      `${RATIO_LABEL}：${expectation.ratios[1]?.text}`,
    );

    await panel.switchTab('credit');
    await panel.hoverAxisIndex(0, 3);
    expect((await panel.trendTooltipLines()).join(' '), '积分图不出现比率行').not.toContain(
      RATIO_LABEL,
    );
  });

  test('AC10 比率行带标题与 ×，柱子仍按原规则过滤排序', async () => {
    const expectation = expectRange(FROM, TO);
    await panel.hoverAxisIndex(0, 3);
    const lines = await panel.trendTooltipLines();
    expect(lines[0]).toBe('2026-11-12');
    expect(lines.at(-1), '比率行在柱子之后').toBe(
      `${RATIO_LABEL}：${expectation.ratios[0]?.text}`,
    );

    const bars = lines.slice(1).filter((line) => !line.includes(RATIO_LABEL));
    expect(bars).toEqual(
      expectation.dayRows('2026-11-12', 'tokens').map(
        (row) => `${row.name}：${formatTokens(row.tokens)}`,
      ),
    );
    expect(lines.join(' ')).not.toContain('ERROR');
    expect(lines.join(' ')).not.toContain('Kimi');

    await panel.hoverAxisIndex(1, 3);
    const mixed = (await panel.trendTooltipLines())
      .slice(1)
      .filter((line) => !line.includes(RATIO_LABEL))
      .map((line) => line.split('：')[0] ?? '');
    expect(mixed).toEqual(
      expectation.dayRows('2026-11-13', 'tokens').map((model) => model.name),
    );
  });

  test('AC14 筛选非 DS 模型时比率整体隐藏，页面无新增文案', async ({ page }) => {
    await panel.selectFilter('model', SAMPLE_MODELS.hy4);
    await panel.hoverAxisIndex(1, 3);
    const lines = await panel.trendTooltipLines();
    expect(lines.join(' ')).not.toContain(RATIO_LABEL);
    expect(lines.slice(1)).toEqual(['Hy4：1.6K']);

    const pageText = await page.evaluate(() => document.body.innerText);
    expect(pageText).not.toContain(RATIO_LABEL);
  });
});
