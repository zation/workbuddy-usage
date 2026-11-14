import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import type { EtlConfig } from '../src/etl/config.ts';
import { closeDatabase, openDatabase } from '../src/etl/database.ts';
import { createRefresher } from '../src/etl/refresh.ts';
import { DEFAULT_GROUP, UNKNOWN_GROUP } from '../src/shared/constants.ts';
import type {
  BreakdownResponse,
  RequestsResponse,
  SummaryResponse,
  TimeseriesResponse,
} from '../src/shared/types.ts';
import { createWorkbuddyDb } from './helpers/external-db.ts';
import { stepLine } from './helpers/jsonl.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

const AUTO_A = '/Users/x/WorkBuddy/2026-11-11-09-00-00';
const AUTO_B = '/Users/x/WorkBuddy/2026-11-12-10-00-00';
const MANUAL_A = '/work/alpha';
const MANUAL_B = '/work/beta';
const CLASH = '/work/默认';

interface Fixture {
  home: string;
  config: EtlConfig;
  db: DatabaseSync;
  app: ReturnType<typeof createApp>;
  refresh: () => Promise<unknown>;
  close: () => void;
}

const fixtures: Fixture[] = [];

function writeSession(home: string, relativePath: string, lines: string[]): void {
  const absolute = join(home, 'projects', relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${lines.join('\n')}\n`);
}

/**
 * 独立夹具：2 个手动分组 + 2 个自动日期目录 + 空 cwd + 1 个展示名撞「默认」的手动分组。
 * token 合计 2100、自动分组 700（2 个请求 / 2 个会话 / 积分 2）。
 */
async function setup(): Promise<Fixture> {
  const home = makeTempDir();
  createWorkbuddyDb(
    home,
    [
      { id: 'm1', cwd: MANUAL_A, title: 'Alpha' },
      { id: 'm2', cwd: MANUAL_B, title: 'Beta' },
      { id: 'd1', cwd: AUTO_A },
      { id: 'd2', cwd: AUTO_B },
      { id: 'u1', cwd: null },
      { id: 'c1', cwd: CLASH },
    ],
    [
      { sessionId: 'm1', creditJson: '{"q1":1}' },
      { sessionId: 'm2', creditJson: '{"q2":0.5}' },
      { sessionId: 'd1', creditJson: '{"q3":2}' },
      { sessionId: 'd2', creditJson: '{"q4":0}' },
      { sessionId: 'u1', creditJson: '{"q5":0}' },
      { sessionId: 'c1', creditJson: null },
    ],
  );

  const day12 = Date.UTC(2026, 10, 12, 10, 0);
  const day13 = Date.UTC(2026, 10, 13, 10, 0);
  const single = (
    requestId: string,
    timestamp: number,
    total: number,
    model: string,
    modelName: string,
  ): string[] => [
    stepLine({ requestId, timestamp, input: total, output: 0, total, model, modelName }),
  ];

  writeSession(home, 'enc-m1/m1.jsonl', single('q1', day12, 100, 'model-a', 'Model-A'));
  writeSession(home, 'enc-m2/m2.jsonl', single('q2', day12, 200, 'model-b', 'Model-B'));
  writeSession(home, 'enc-d1/d1.jsonl', single('q3', day12, 300, 'model-a', 'Model-A'));
  writeSession(home, 'enc-d2/d2.jsonl', single('q4', day13, 400, 'model-c', 'Model-C'));
  writeSession(home, 'enc-u1/u1.jsonl', single('q5', day13, 500, 'model-a', 'Model-A'));
  writeSession(home, 'enc-c1/c1.jsonl', single('q6', day13, 600, 'model-b', 'Model-B'));

  const config: EtlConfig = { workbuddyHome: home, databasePath: join(home, '.data', 'database.db') };
  const { db } = openDatabase(config.databasePath);
  const refresher = createRefresher(db, config);
  await refresher.refresh();

  let closed = false;
  const fixture: Fixture = {
    home,
    config,
    db,
    app: createApp({ db, refresher }),
    refresh: refresher.refresh,
    close: () => {
      if (!closed) {
        closed = true;
        closeDatabase(db);
      }
    },
  };
  fixtures.push(fixture);
  return fixture;
}

async function getJson<T>(app: ReturnType<typeof createApp>, path: string): Promise<T> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

function groupQuery(group: string): string {
  return `group=${encodeURIComponent(group)}`;
}

afterEach(() => {
  while (fixtures.length > 0) {
    fixtures.pop()?.close();
  }
  cleanupTempDirs();
});

describe('分组口径归一化', () => {
  it('按分组拆分把两个日期目录合并成一行「默认」（R4 / AC2 / AC3）', async () => {
    const { app } = await setup();
    const body = await getJson<BreakdownResponse>(app, '/api/breakdown?dim=group');

    const keys = body.rows.map((row) => row.key);
    expect(keys).not.toContain(AUTO_A);
    expect(keys).not.toContain(AUTO_B);
    expect(keys.filter((key) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/u.test(key))).toEqual([]);
    expect(keys).toEqual([DEFAULT_GROUP, CLASH, UNKNOWN_GROUP, MANUAL_B, MANUAL_A]);

    const auto = body.rows[0];
    expect(auto).toMatchObject({
      key: DEFAULT_GROUP,
      name: DEFAULT_GROUP,
      totalTokens: 700,
      inputTokens: 700,
      credit: 2,
      requestCount: 2,
      sessionCount: 2,
    });
    expect(auto?.tokenShare).toBeCloseTo(700 / 2100, 10);
    expect(auto?.creditShare).toBeCloseTo(2 / 3.5, 10);
  });

  it('「默认」数值等于各自动分组按现有口径重新聚合（AC3）', async () => {
    const { app } = await setup();
    const merged = await getJson<BreakdownResponse>(app, '/api/breakdown?dim=group');
    const auto = merged.rows.find((row) => row.key === DEFAULT_GROUP);

    const perPath = await Promise.all(
      [AUTO_A, AUTO_B].map(async (path) => {
        const breakdown = await getJson<BreakdownResponse>(
          app,
          `/api/breakdown?dim=group&${groupQuery(path)}`,
        );
        const requests = await getJson<RequestsResponse>(app, `/api/requests?${groupQuery(path)}`);
        return { path, breakdown, requests };
      }),
    );

    for (const { path, breakdown, requests } of perPath) {
      expect(breakdown.rows).toHaveLength(1);
      expect(new Set(requests.rows.map((row) => row.group))).toEqual(new Set([path]));
      expect(breakdown.rows[0]?.totalTokens).toBe(
        requests.rows.reduce((total, row) => total + row.totalTokens, 0),
      );
    }

    const sum = (pick: (row: RequestsResponse['rows'][number]) => number): number =>
      perPath.reduce(
        (total, { requests }) => total + requests.rows.reduce((inner, row) => inner + pick(row), 0),
        0,
      );
    const sessions = new Set(perPath.flatMap(({ requests }) => requests.rows.map((row) => row.session)));

    expect(sum((row) => row.totalTokens)).toBe(auto?.totalTokens);
    expect(sum((row) => row.credit)).toBe(auto?.credit);
    expect(sum(() => 1)).toBe(auto?.requestCount);
    expect(sessions.size).toBe(auto?.sessionCount);
  });

  it('手动分组数值不变，撞名分组保留完整路径业务键（R4）', async () => {
    const { app } = await setup();
    const body = await getJson<BreakdownResponse>(app, '/api/breakdown?dim=group');
    const byKey = new Map(body.rows.map((row) => [row.key, row]));

    expect(byKey.get(MANUAL_A)).toMatchObject({ name: 'alpha', totalTokens: 100 });
    expect(byKey.get(MANUAL_B)).toMatchObject({ name: 'beta', totalTokens: 200 });
    expect(byKey.get(CLASH)).toMatchObject({
      key: CLASH,
      name: DEFAULT_GROUP,
      totalTokens: 600,
    });
    expect(byKey.get(DEFAULT_GROUP)?.totalTokens).not.toBe(byKey.get(CLASH)?.totalTokens);
  });

  it('未知分组独立成行，不并入「默认」（R7 / AC7）', async () => {
    const { app } = await setup();
    const all = await getJson<BreakdownResponse>(app, '/api/breakdown?dim=group');
    expect(all.rows.find((row) => row.key === UNKNOWN_GROUP)).toMatchObject({
      name: UNKNOWN_GROUP,
      totalTokens: 500,
    });

    const auto = await getJson<BreakdownResponse>(
      app,
      `/api/breakdown?dim=group&${groupQuery(DEFAULT_GROUP)}`,
    );
    expect(auto.rows.map((row) => row.key)).toEqual([DEFAULT_GROUP]);
    expect(auto.rows[0]?.totalTokens).toBe(700);
  });

  it('虚拟键筛选作用于四个端点（R5 / AC4）', async () => {
    const { app } = await setup();
    const query = groupQuery(DEFAULT_GROUP);

    const summary = await getJson<SummaryResponse>(app, `/api/summary?${query}`);
    expect(summary.token).toMatchObject({
      totalTokens: 700,
      inputTokens: 700,
      requestCount: 2,
      sessionCount: 2,
    });
    expect(summary.credit.credit).toBe(2);

    const timeseries = await getJson<TimeseriesResponse>(app, `/api/timeseries?${query}`);
    expect(new Set(timeseries.rows.map((row) => row.model))).toEqual(
      new Set(['model-a', 'model-c']),
    );
    expect(timeseries.rows.reduce((total, row) => total + row.totalTokens, 0)).toBe(700);
    expect(timeseries).not.toHaveProperty('days');
    expect(new Set(timeseries.rows.map((row) => row.date))).toEqual(
      new Set(['2026-11-12', '2026-11-13']),
    );

    const groups = await getJson<BreakdownResponse>(
      app,
      `/api/breakdown?dim=group&${query}`,
    );
    expect(groups.rows.map((row) => row.key)).toEqual([DEFAULT_GROUP]);

    const sessions = await getJson<BreakdownResponse>(
      app,
      `/api/breakdown?dim=session&${query}`,
    );
    expect(sessions.rows.map((row) => row.key).sort()).toEqual(['d1', 'd2']);

    const models = await getJson<BreakdownResponse>(app, `/api/breakdown?dim=model&${query}`);
    expect(models.rows.map((row) => [row.key, row.totalTokens])).toEqual([
      ['model-c', 400],
      ['model-a', 300],
    ]);

    const requests = await getJson<RequestsResponse>(app, `/api/requests?${query}`);
    expect(requests.rows.map((row) => row.requestId).sort()).toEqual(['q3', 'q4']);
    expect(requests.rows.map((row) => row.groupName)).toEqual([DEFAULT_GROUP, DEFAULT_GROUP]);

    const cleared = await getJson<SummaryResponse>(app, '/api/summary');
    expect(cleared.token.totalTokens).toBe(2100);
    expect(cleared.token.requestCount).toBe(6);
  });

  it('明细展示名与业务键分离，hover 仍取原始路径（R6 / AC5）', async () => {
    const { app } = await setup();
    const body = await getJson<RequestsResponse>(app, '/api/requests');

    const auto = body.rows.find((row) => row.requestId === 'q3');
    expect(auto).toMatchObject({ groupName: DEFAULT_GROUP, group: AUTO_A });

    const clash = body.rows.find((row) => row.requestId === 'q6');
    expect(clash).toMatchObject({ groupName: DEFAULT_GROUP, group: CLASH });

    const unknown = body.rows.find((row) => row.requestId === 'q5');
    expect(unknown).toMatchObject({ groupName: UNKNOWN_GROUP, group: UNKNOWN_GROUP });
  });

  it('三个维度拆分之和都等于总览（AC6）', async () => {
    const { app } = await setup();
    const summary = await getJson<SummaryResponse>(app, '/api/summary');
    const totals: number[] = [];
    for (const dimension of ['group', 'session', 'model']) {
      const body = await getJson<BreakdownResponse>(app, `/api/breakdown?dim=${dimension}`);
      totals.push(body.rows.reduce((total, row) => total + row.totalTokens, 0));
    }
    expect(totals).toEqual([2100, 2100, 2100]);
    expect(summary.token.totalTokens).toBe(2100);
  });

  it('删库重建后 group 聚合一致（AC8）', async () => {
    const first = await setup();
    const before = await getJson<BreakdownResponse>(first.app, '/api/breakdown?dim=group');
    first.db.prepare('UPDATE meta SET schema_version = schema_version - 1 WHERE id = 1').run();
    first.close();

    const reopened = openDatabase(first.config.databasePath);
    const refresher = createRefresher(reopened.db, first.config);
    await refresher.refresh();
    const after = await getJson<BreakdownResponse>(
      createApp({ db: reopened.db, refresher }),
      '/api/breakdown?dim=group',
    );

    expect(after.rows).toEqual(before.rows);
    expect(
      reopened.db.prepare('SELECT COUNT(*) AS n FROM groups').get(),
    ).toEqual({ n: 6 });
    closeDatabase(reopened.db);
  });
});
