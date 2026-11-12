import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import type {
  BreakdownResponse,
  RequestsResponse,
  SummaryResponse,
  TimeseriesResponse,
} from '../src/shared/types.ts';
import { createStatsFixture } from './helpers/stats-fixture.ts';
import type { StatsFixture } from './helpers/stats-fixture.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

const fixtures: StatsFixture[] = [];

async function setup() {
  const fixture = await createStatsFixture();
  fixtures.push(fixture);
  await fixture.refresher.refresh();
  const app = createApp({ db: fixture.db, refresher: fixture.refresher });
  return { fixture, app };
}

function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.close();
  }
  cleanupTempDirs();
});

describe('服务层聚合', () => {
  it('summary 返回 token、积分与覆盖率', async () => {
    const { app } = await setup();
    const response = await app.request('/api/summary');
    expect(response.status).toBe(200);
    const body = (await response.json()) as SummaryResponse;

    expect(body.token).toEqual({
      totalTokens: 1500,
      inputTokens: 900,
      outputTokens: 600,
      cacheReadTokens: 10,
      requestCount: 5,
      sessionCount: 3,
    });
    expect(body.credit).toEqual({
      credit: 3.75,
      requestCount: 5,
      sessionCount: 3,
      creditedRequestCount: 3,
      uncreditedRequestCount: 2,
      coverage: 0.6,
    });
  });

  it('三个维度拆分之和都等于总览（AC3）', async () => {
    const { app } = await setup();
    const summary = (await (await app.request('/api/summary')).json()) as SummaryResponse;

    for (const dimension of ['group', 'model', 'session'] as const) {
      const response = await app.request(`/api/breakdown?dim=${dimension}`);
      const body = (await response.json()) as BreakdownResponse;
      expect(body.dimension).toBe(dimension);
      const tokenSum = body.rows.reduce((sum, row) => sum + row.totalTokens, 0);
      const requestSum = body.rows.reduce((sum, row) => sum + row.requestCount, 0);
      const shareSum = body.rows.reduce((sum, row) => sum + row.tokenShare, 0);
      expect(tokenSum).toBe(summary.token.totalTokens);
      expect(requestSum).toBe(summary.token.requestCount);
      expect(shareSum).toBeCloseTo(1, 10);
    }
  });

  it('分组、会话、模型拆分的业务键与展示名正确', async () => {
    const { app } = await setup();

    const groups = (await (await app.request('/api/breakdown?dim=group')).json()) as BreakdownResponse;
    expect(groups.rows.map((row) => [row.key, row.name, row.totalTokens])).toEqual([
      ['/work/alpha', 'alpha', 700],
      ['/work/gamma', 'gamma', 500],
      ['/work/beta', 'beta', 300],
    ]);
    expect(groups.rows[0]?.tokenShare).toBeCloseTo(700 / 1500, 10);

    const models = (await (await app.request('/api/breakdown?dim=model')).json()) as BreakdownResponse;
    expect(models.rows.map((row) => [row.key, row.name, row.totalTokens])).toEqual([
      ['model-a', 'Model-A', 700],
      ['model-c', 'model-c', 500],
      ['model-b', 'Model-B', 300],
    ]);

    const sessions = (await (await app.request('/api/breakdown?dim=session')).json()) as BreakdownResponse;
    expect(sessions.rows.map((row) => [row.key, row.name, row.totalTokens])).toEqual([
      ['s1', 'Alpha 会话', 700],
      ['s3', 's3', 500],
      ['s2', '自定义 Beta', 300],
    ]);
  });

  it('timeseries 按天、按模型拆分并补齐日期', async () => {
    const { app } = await setup();
    const response = await app.request('/api/timeseries?from=2026-11-11&to=2026-11-13');
    const body = (await response.json()) as TimeseriesResponse;

    expect(body.days).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);
    expect(body.rows.map((row) => [row.date, row.model, row.totalTokens])).toEqual([
      ['2026-11-11', 'model-a', 100],
      ['2026-11-12', 'model-a', 200],
      ['2026-11-12', 'model-b', 300],
      ['2026-11-13', 'model-a', 400],
      ['2026-11-13', 'model-c', 500],
    ]);
    expect(body.rows[0]?.modelName).toBe('Model-A');

    const all = (await (await app.request('/api/timeseries')).json()) as TimeseriesResponse;
    expect(all.days).toEqual(['2026-11-11', '2026-11-12', '2026-11-13']);

    const partial = (await (
      await app.request('/api/timeseries?from=2026-11-10')
    ).json()) as TimeseriesResponse;
    expect(partial.days).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
  });

  it('四个筛选条件按业务键生效', async () => {
    const { app } = await setup();
    const total = async (query: string) =>
      ((await (await app.request(`/api/summary?${query}`)).json()) as SummaryResponse).token
        .totalTokens;

    expect(await total('group=%2Fwork%2Falpha')).toBe(700);
    expect(await total('session=s2')).toBe(300);
    expect(await total('model=model-b')).toBe(300);
    expect(await total('from=2026-11-12&to=2026-11-12')).toBe(500);
    expect(await total('group=%2Fwork%2Falpha&model=model-a')).toBe(700);
  });

  it('非法日期、排序与维度返回 400', async () => {
    const { app } = await setup();
    expect((await app.request('/api/summary?from=2026-02-30')).status).toBe(400);
    expect((await app.request('/api/summary?from=2026-11-13&to=2026-11-11')).status).toBe(400);
    expect((await app.request('/api/breakdown?dim=date')).status).toBe(400);
    expect((await app.request('/api/requests?sort=unknown')).status).toBe(400);
    expect((await app.request('/api/requests?order=up')).status).toBe(400);
    expect((await app.request('/api/not-exist')).status).toBe(404);
  });
});

describe('请求级明细', () => {
  it('默认按合计 token 降序，返回业务键与展示名', async () => {
    const { app } = await setup();
    const body = (await (await app.request('/api/requests')).json()) as RequestsResponse;
    expect(body.rows.map((row) => row.requestId)).toEqual(['d1', 'c1', 'b1', 'a2', 'a1']);

    const b1 = body.rows.find((row) => row.requestId === 'b1');
    expect(b1).toMatchObject({
      totalTokens: 300,
      stepCount: 2,
      group: '/work/beta',
      groupName: 'beta',
      session: 's2',
      sessionName: '自定义 Beta',
      model: 'model-b',
      modelName: 'Model-B',
      credit: 2.25,
      hasCredit: true,
      isSubagent: false,
    });

    const subagent = body.rows.find((row) => row.requestId === 'c1');
    expect(subagent).toMatchObject({
      isSubagent: true,
      session: 's1',
      groupName: 'alpha',
      credit: 0,
      hasCredit: false,
    });

    const zeroCredit = body.rows.find((row) => row.requestId === 'a2');
    expect(zeroCredit).toMatchObject({ credit: 0, hasCredit: true });
  });

  it('支持按积分升序排序', async () => {
    const { app } = await setup();
    const body = (await (
      await app.request('/api/requests?sort=credit&order=asc')
    ).json()) as RequestsResponse;
    expect(body.rows.map((row) => row.requestId)).toEqual(['a2', 'c1', 'd1', 'a1', 'b1']);
  });

  it('API 返回值不含派生库内部 id（C14）', async () => {
    const { app } = await setup();
    for (const path of [
      '/api/summary',
      '/api/timeseries',
      '/api/breakdown?dim=group',
      '/api/requests',
    ]) {
      const payload = await (await app.request(path)).json();
      const keys = new Set<string>();
      collectKeys(payload, keys);
      expect(keys.has('id')).toBe(false);
    }
  });
});

describe('生产模式与刷新入口', () => {
  it('提供静态资源并将未知 API 保持为 JSON 404', async () => {
    const fixture = await createStatsFixture();
    fixtures.push(fixture);
    await fixture.refresher.refresh();

    const staticRoot = makeTempDir();
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<html><body>用量面板</body></html>');
    writeFileSync(join(staticRoot, 'assets/app.js'), 'console.log("panel");');

    const app = createApp({ db: fixture.db, staticRoot });

    const indexResponse = await app.request('/');
    expect(indexResponse.status).toBe(200);
    expect(await indexResponse.text()).toContain('用量面板');

    const assetResponse = await app.request('/assets/app.js');
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toContain('panel');

    const apiResponse = await app.request('/api/unknown');
    expect(apiResponse.status).toBe(404);
    expect(await apiResponse.json()).toEqual({ error: 'Not Found' });
  });

  it('POST /api/refresh 返回刷新统计', async () => {
    const { fixture, app } = await setup();
    const response = await app.request('/api/refresh', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      skipped: boolean;
      scannedFiles: number;
      changedFiles: number;
      creditAttached: number;
    };
    expect(body.skipped).toBe(false);
    expect(body.scannedFiles).toBe(4);
    expect(body.changedFiles).toBe(0);
    expect(body.creditAttached).toBe(0);
    expect(fixture.db.prepare('SELECT COUNT(*) AS n FROM requests').get()).toEqual({ n: 5 });
  });

  it('未提供刷新入口时返回 501', async () => {
    const fixture = await createStatsFixture();
    fixtures.push(fixture);
    const app = createApp({ db: fixture.db });
    expect((await app.request('/api/refresh', { method: 'POST' })).status).toBe(501);
  });
});
