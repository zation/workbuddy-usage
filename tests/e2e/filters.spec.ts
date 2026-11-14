import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import type { BreakdownResponse } from '../../src/shared/types.ts';
import { expectRange } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;
const EMPTY_DAY = '2026-11-09';

test.describe('筛选与时间区', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  test('AC1 列表点击与下拉框写入同一份筛选', async () => {
    const expectedKey = expectRange(FROM, TO).groupRows('tokens')[0]?.key ?? '';
    expect(expectedKey).toBe('/work/alpha');

    await panel.applyFilter(() => panel.rows('按分组').first().click());
    await expect(panel.filterTrigger('group')).toHaveAttribute('data-value', expectedKey);
    const byClick = panel.requestsMatching('/api/summary').at(-1) ?? '';
    expect(byClick).toContain(`group=${encodeURIComponent(expectedKey)}`);

    await panel.reset();
    await panel.selectFilter('group', expectedKey);
    const bySelect = panel.requestsMatching('/api/summary').at(-1) ?? '';
    expect(bySelect).toBe(byClick);
  });

  test('AC2 分组下拉无日期目录条目且与聚合结果一致', async () => {
    const options = (await panel.filterOptions('group')).filter((value) => value !== '');
    const api = await panel.api<BreakdownResponse>(
      `/api/breakdown?dim=group&from=${FROM}&to=${TO}`,
    );
    const apiKeys = api.rows.map((row) => row.key);

    expect([...options].sort()).toEqual([...apiKeys].sort());
    expect(options.filter((value) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/u.test(value))).toEqual(
      [],
    );
    expect(options.includes('默认'), '「默认」来自自动分组').toBe(true);
    expect(apiKeys.includes('默认')).toBe(true);
  });

  test('AC2 空范围内「默认」不占位', async () => {
    await panel.setRange(EMPTY_DAY, EMPTY_DAY);
    const options = await panel.filterOptions('group');
    expect(options).toEqual(['']);

    const api = await panel.api<BreakdownResponse>(
      `/api/breakdown?dim=group&from=${EMPTY_DAY}&to=${EMPTY_DAY}`,
    );
    expect(api.rows).toEqual([]);
  });

  test('AC4 选中「默认」后各视图只含自动分组数据', async ({ page }) => {
    await panel.selectFilter('group', '默认');
    expect(panel.requestsMatching('/api/summary').at(-1) ?? '').toContain(
      `group=${encodeURIComponent('默认')}`,
    );

    await expect(panel.rows('按分组')).toHaveCount(1);
    await expect(panel.breakdownPanel('按分组').locator('.breakdown-name')).toHaveText('默认');
    await expect(panel.metric('合计 Token')).toHaveText('500');

    expect((await panel.filterOptions('model')).filter(Boolean)).toEqual(['hy4']);
    expect((await panel.filterOptions('session')).filter(Boolean)).toEqual(['s3']);

    await panel.hoverAxisIndex(1, 3);
    expect((await panel.trendTooltipLines()).slice(1)).toEqual(['Hy4：500']);

    await page.locator('.table-toggle').first().click();
    await expect(page.locator('.table-body tbody tr')).toHaveCount(1);
    await expect(page.locator('.table-body tbody td').nth(1)).toHaveText('默认');
  });

  test('AC12 三个维度下拉 ARIA 一致、键盘与点击外部关闭可用，时间区为四按钮加日期框', async ({
    page,
  }) => {
    const aria = await page.evaluate(() =>
      ['group', 'session', 'model'].map((id) => {
        const trigger = document.getElementById(`filter-${id}`);
        const controls = trigger?.getAttribute('aria-controls') ?? '';
        return {
          role: trigger?.getAttribute('role') ?? '',
          haspopup: trigger?.getAttribute('aria-haspopup') ?? '',
          expanded: trigger?.getAttribute('aria-expanded') ?? '',
          controlsExists: Boolean(document.getElementById(controls)),
          activedescendant: trigger?.getAttribute('aria-activedescendant'),
          selected: trigger?.closest('.select')?.querySelectorAll('.select-option[aria-selected="true"]').length ?? 0,
        };
      }),
    );
    expect(aria).toHaveLength(3);
    for (const item of aria) {
      expect(item.role).toBe('combobox');
      expect(item.haspopup).toBe('listbox');
      expect(item.expanded, '关闭态 aria-expanded').toBe('false');
      expect(item.controlsExists).toBe(true);
      expect(item.activedescendant).toBeNull();
      expect(item.selected).toBe(1);
    }

    const trigger = panel.filterTrigger('group');
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const firstActive = await trigger.getAttribute('aria-activedescendant');
    expect(firstActive).toBeTruthy();

    await page.keyboard.press('ArrowDown');
    const secondActive = await trigger.getAttribute('aria-activedescendant');
    expect(secondActive).not.toBe(firstActive);

    const pickedValue = await page.evaluate(
      (id) => document.getElementById(id ?? '')?.getAttribute('data-value') ?? '',
      secondActive,
    );
    expect(pickedValue).not.toBe('');
    await panel.applyFilter(() => page.keyboard.press('Enter'));
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('data-value', pickedValue);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('ArrowDown');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.app-header').click({ position: { x: 2, y: 2 } });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    const time = await panel.timeState();
    expect(time.buttons).toEqual(['today', 'threeDays', 'sevenDays', 'thirtyDays']);
    const pressedAttrs = await page
      .locator('[data-quick]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-pressed')));
    expect(pressedAttrs.every((value) => value === 'true' || value === 'false')).toBe(true);
    await expect(page.locator('.filter-time .select')).toHaveCount(0);
    await expect(page.locator('.filter-time [role=group]')).toHaveAttribute('aria-label', '时间范围');
    await panel.openDateRange();
    await expect(page.locator('.date-range input[type=date]')).toHaveCount(2);
  });

  test('AC1 首屏默认近 3 天，日期框由「更多」展开', async ({ page }) => {
    const state = await panel.timeState();
    expect(state.pressed).toEqual(['threeDays']);
    expect(state.from).toBe(FROM);
    expect(state.to).toBe(TO);
    await expect(page.locator('.date-range')).toBeHidden();
    await panel.openDateRange();
    await expect(page.locator('.date-range')).toBeVisible();
  });

  test('AC2 快捷按钮回填区间与查询串，手改日期按反向匹配重算高亮', async () => {
    const cases: Array<[string, string, string]> = [
      ['today', TO, TO],
      ['threeDays', FROM, TO],
      ['sevenDays', addDays(TO, -6), TO],
      ['thirtyDays', addDays(TO, -29), TO],
    ];
    for (const [key, from, to] of cases) {
      await panel.quick(key);
      const state = await panel.timeState();
      expect(state.pressed, `${key} 高亮`).toEqual([key]);
      expect(state.from, `${key} 起始`).toBe(from);
      expect(state.to, `${key} 结束`).toBe(to);
      const url = panel.requestsMatching('/api/summary').at(-1) ?? '';
      expect(url).toContain(`from=${from}`);
      expect(url).toContain(`to=${to}`);
    }

    await panel.setRange(FROM, TO);
    expect((await panel.timeState()).pressed, '手改回预设区间后重新高亮').toEqual(['threeDays']);

    await panel.setRange(addDays(TO, -3), TO);
    expect((await panel.timeState()).pressed, '非预设区间不高亮').toEqual([]);
  });

  test('AC3 起始晚于结束不写入筛选且不发请求，清空日期框回弹到生效值', async ({ page }) => {
    await panel.openDateRange();
    const fromInput = page.locator('.date-range input[type=date]').nth(0);
    const toInput = page.locator('.date-range input[type=date]').nth(1);
    const before = panel.requestsMatching('/api/summary').length;

    await fromInput.fill(addDays(TO, 1));
    await expect(page.locator('.filter-error')).toHaveText('起始日期不能晚于结束日期');
    await expect(fromInput).toHaveValue(FROM);
    await page.waitForTimeout(300);
    expect(panel.requestsMatching('/api/summary').length, '非法区间不发请求').toBe(before);

    await toInput.fill('');
    await expect(toInput).toHaveValue(TO);
    await expect(page.locator('.filter-error')).toHaveText('起始日期不能晚于结束日期');
  });
});
