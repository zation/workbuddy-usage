import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { addDays, toDateKey } from '../../src/shared/dates.ts';
import type { BreakdownResponse, SummaryResponse, TimeseriesResponse } from '../../src/shared/types.ts';
import { expectRange } from './expectations.ts';
import { PanelPage } from './panel-page.ts';
import { BASE_DATE, FROZEN_NOW_MS } from './sample.ts';

const DEFAULT_FROM = addDays(BASE_DATE, -2);
const DEFAULT_TO = BASE_DATE;

test.describe('固定样本自检', () => {
  test('样本目录、冻结时间与聚合结果自洽', async ({ page }) => {
    const panel = new PanelPage(page);
    await panel.open();

    expect(toDateKey(FROZEN_NOW_MS), '冻结时间必须落在样本基准日').toBe(BASE_DATE);

    const home = resolve('.data/e2e/home');
    expect(existsSync(resolve(home, 'workbuddy.db')), '样本 WorkBuddy 数据库存在').toBe(true);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolute = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
        } else if (entry.name.endsWith('.jsonl')) {
          files.push(absolute);
        }
      }
    };
    walk(resolve(home, 'projects'));
    expect(files.length, '样本会话文件数（11 个主会话 + 1 个子代理）').toBe(12);

    const expectation = expectRange(DEFAULT_FROM, DEFAULT_TO);
    expect(expectation.token.totalTokens, '默认区间 token 合计').toBe(6510);
    expect(expectation.token.requestCount, '默认区间请求数').toBe(15);
    expect(expectation.models.length, '样本模型数').toBe(5);

    const summary = await panel.api<SummaryResponse>(
      `/api/summary?from=${DEFAULT_FROM}&to=${DEFAULT_TO}`,
    );
    expect(summary.token.totalTokens).toBe(expectation.token.totalTokens);
    expect(summary.token.inputTokens).toBe(expectation.token.inputTokens);
    expect(summary.token.outputTokens).toBe(expectation.token.outputTokens);
    expect(summary.token.cacheReadTokens).toBe(expectation.token.cacheReadTokens);
    expect(summary.token.requestCount).toBe(expectation.token.requestCount);
    expect(summary.token.sessionCount).toBe(expectation.token.sessionCount);
    expect(summary.credit.credit).toBeCloseTo(expectation.credit.credit, 6);

    const models = await panel.api<BreakdownResponse>('/api/breakdown?dim=model');
    expect(models.rows.map((row) => row.key).sort()).toEqual(
      expectation.models.map((model) => model.key).sort(),
    );

    const series = await panel.api<TimeseriesResponse>('/api/timeseries');
    expect([...new Set(series.rows.map((row) => row.date))].sort()).toEqual([
      '2026-11-10',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    expect(series.ratios.length, '有 DS 请求的日期数').toBe(3);

    const scoped = await panel.api<TimeseriesResponse>(
      `/api/timeseries?from=${DEFAULT_FROM}&to=${DEFAULT_TO}`,
    );
    expect(
      scoped.ratios.map((row) => ({ date: row.date, text: `${(row.ratio ?? 0).toFixed(2)}×` })),
    ).toEqual(
      expectation.ratios.map((row) => ({ date: row.date, text: row.text })),
    );
  });
});
