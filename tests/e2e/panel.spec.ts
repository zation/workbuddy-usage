import { expect, test } from '@playwright/test';
import { QUICK_PRESETS } from '../../src/web/filters.ts';

test('面板首屏加载：标题、两个 tab、六个指标卡与四个快捷区间', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'WorkBuddy 用量统计' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Token 用量' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.metric-card')).toHaveCount(6);
  await expect(page.locator('.quick-button[data-quick]')).toHaveText(
    QUICK_PRESETS.map((preset) => preset.label),
  );
  expect(pageErrors).toEqual([]);
});
