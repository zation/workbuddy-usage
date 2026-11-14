import { expect, test } from '@playwright/test';
import { addDays } from '../../src/shared/dates.ts';
import { expectRange } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE } from './sample.ts';

const FROM = addDays(BASE_DATE, -2);
const TO = BASE_DATE;

test.describe('页面结构与网络', () => {
  let panel: PanelPage;

  test.beforeEach(async ({ page }) => {
    panel = new PanelPage(page);
    await panel.open();
  });

  test('AC3 不存在配色专用的全量模型请求，也不产生外部域名请求', async () => {
    const paletteOnly = panel
      .requestsMatching('/api/breakdown')
      .map((url) => new URL(url))
      .filter(
        (url) => url.searchParams.get('dim') === 'model' && [...url.searchParams.keys()].length === 1,
      );
    expect(paletteOnly.map((url) => url.href), '无参数的 dim=model 请求').toEqual([]);

    const external = panel.requests
      .map((request) => new URL(request.url()))
      .filter((url) => url.hostname !== '127.0.0.1');
    expect(external.map((url) => url.href), '外部域名请求').toEqual([]);
  });

  test('AC2 两个 tab、默认激活 Token、aria 关联与单图表渲染', async ({ page }) => {
    const tabs = page.locator('[role=tab]');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');

    const structure = await page.evaluate(() => {
      const tabNodes = [...document.querySelectorAll('[role=tab]')];
      const panelNodes = [...document.querySelectorAll('[role=tabpanel]')];
      return {
        tabIds: tabNodes.map((node) => node.id),
        controls: tabNodes.map((node) => node.getAttribute('aria-controls') ?? ''),
        controlsExist: tabNodes.map((node) => Boolean(document.getElementById(node.getAttribute('aria-controls') ?? ''))),
        panelIds: panelNodes.map((node) => node.id),
        labelledBy: panelNodes.map((node) => node.getAttribute('aria-labelledby') ?? ''),
        hidden: panelNodes.map((node) => node.hasAttribute('hidden')),
        canvases: document.querySelectorAll('canvas').length,
      };
    });

    expect(structure.tabIds).toEqual(['token-tab', 'credit-tab']);
    expect(structure.controls).toEqual(['token-module', 'credit-module']);
    expect(structure.controlsExist).toEqual([true, true]);
    expect(structure.panelIds).toEqual(['token-module', 'credit-module']);
    expect(structure.labelledBy).toEqual(['token-tab', 'credit-tab']);
    expect(structure.hidden, '未激活的积分面板隐藏').toEqual([false, true]);
    expect(structure.canvases, '同一时刻只渲染一张图表').toBe(1);
  });

  test('AC4 明细默认折叠且不请求，展开后按时间降序并表内滚动', async ({ page }) => {
    const toggle = page.locator('.table-toggle').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel.requestsMatching('/api/requests'), '折叠时不请求明细').toEqual([]);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.table-body tbody tr')).toHaveCount(expectRange(FROM, TO).requests.length);

    const detailRequests = panel.requestsMatching('/api/requests');
    expect(detailRequests).toHaveLength(1);
    expect(detailRequests[0]).toContain('sort=startedAt');
    expect(detailRequests[0]).toContain('order=desc');

    await expect(page.locator('.table-body .table-wrap')).toHaveCSS('max-height', '440px');
    await expect(page.locator('.table-body th[aria-sort=descending]')).toHaveCount(1);
  });

  test('AC3 拆分列表最多 8 行、行高一致、无内部滚动且项数为全量', async ({ page }) => {
    const expectation = expectRange(FROM, TO);
    const panels = page.locator('.panel.breakdown');
    await expect(panels).toHaveCount(3);

    const groupCount = expectation.groupRows('tokens').length;
    expect(groupCount, '样本需要超过 8 个分组才能验证截断').toBeGreaterThan(8);

    for (const title of ['按分组', '按对话', '按模型']) {
      const panelNode = panel.breakdownPanel(title);
      const rows = panelNode.locator('.breakdown-row');
      const shown = await rows.count();
      expect(shown, `${title} 行数`).toBeLessThanOrEqual(8);
      expect(shown, `${title} 行数`).toBeGreaterThan(0);

      const shapes = await rows.evaluateAll((nodes) => {
        const heights = new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
        const list = nodes[0]?.closest('.breakdown-list') as HTMLElement | null;
        return {
          heights: [...heights],
          scrollable: list ? list.scrollHeight > list.clientHeight + 1 : false,
        };
      });
      expect(shapes.heights, `${title} 行高一致`).toHaveLength(1);
      expect(shapes.scrollable, `${title} 无内部滚动`).toBe(false);

      const meta = await panelNode.locator('.panel-meta').innerText();
      expect(Number.parseInt(meta, 10), `${title} 项数为全量`).toBeGreaterThanOrEqual(shown);
    }

    await expect(panel.rows('按分组')).toHaveCount(8);
    await expect(panel.breakdownPanel('按分组').locator('.panel-meta')).toHaveText(`${groupCount} 项`);
  });
});
