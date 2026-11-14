import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { EtlConfig } from '../src/etl/config.ts';
import { closeDatabase, openDatabase } from '../src/etl/database.ts';
import { createRefresher } from '../src/etl/refresh.ts';
import type { RequestRow, RefreshResult } from '../src/shared/types.ts';
import { getBreakdown, getRequests, getSummary, getTimeseries } from '../server/query.ts';
import { createWorkbuddyDb } from './helpers/external-db.ts';
import { stepLine } from './helpers/jsonl.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

interface AcceptanceFixture {
  home: string;
  config: EtlConfig;
  db: ReturnType<typeof openDatabase>['db'];
  refresh: () => Promise<RefreshResult>;
  close: () => void;
}

const opened: AcceptanceFixture[] = [];

const day11 = Date.UTC(2026, 10, 11, 10, 0);
const day12 = Date.UTC(2026, 10, 12, 10, 0);
const day13 = Date.UTC(2026, 10, 13, 10, 0);

function writeProject(home: string, relativePath: string, lines: string[]): void {
  const absolute = join(home, 'projects', relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${lines.join('\n')}\n`);
}

function externalDb(home: string): DatabaseSync {
  return new DatabaseSync(join(home, 'workbuddy.db'));
}

function openFixture(home: string): AcceptanceFixture {
  const config: EtlConfig = {
    workbuddyHome: home,
    databasePath: join(home, '.data', 'database.db'),
  };
  const { db } = openDatabase(config.databasePath);
  const fixture: AcceptanceFixture = {
    home,
    config,
    db,
    refresh: createRefresher(db, config).refresh,
    close: () => closeDatabase(db),
  };
  opened.push(fixture);
  return fixture;
}

function createFixture(): AcceptanceFixture {
  const home = makeTempDir();
  createWorkbuddyDb(
    home,
    [
      { id: 'sess-alpha-0001', cwd: '/work/alpha', title: 'Alpha 会话' },
      { id: 'sess-beta-0002', cwd: '/work/beta', customTitle: 'Beta 自定义' },
      { id: 'sess-gamma-0003', cwd: '/work/gamma', title: 'Gamma 会话' },
      { id: 'sess-delta-0004', cwd: '/work/delta', title: 'Delta 已删除', deletedAt: 123 },
    ],
    [
      { sessionId: 'sess-alpha-0001', creditJson: '{"r1":1.5,"r2":0}' },
      { sessionId: 'sess-beta-0002', creditJson: '{"r4":2.25}' },
      { sessionId: 'sess-gamma-0003', creditJson: null },
    ],
  );

  writeProject(home, 'enc1/sess-alpha-0001.jsonl', [
    stepLine({ requestId: 'r1', timestamp: day11, input: 30, output: 20, cache: 5, total: 50 }),
    stepLine({ requestId: 'r1', timestamp: day11 + 1000, input: 60, output: 40, cache: 10, total: 100 }),
    stepLine({ requestId: 'r1', timestamp: day11 + 2000, input: 90, output: 60, cache: 20, total: 150 }),
    stepLine({ requestId: 'r1', timestamp: day11 + 3000, input: 120, output: 80, cache: 30, total: 200 }),
    stepLine({ requestId: 'r1', timestamp: day11 + 4000, input: 150, output: 100, cache: 50, total: 250 }),
    stepLine({ requestId: 'r2', timestamp: day11 + 5000, input: 10, output: 5 }),
  ]);
  writeProject(home, 'enc1/sess-beta-0002.jsonl', [
    stepLine({ requestId: 'r4', timestamp: day12, input: 180, output: 120, model: 'model-b', modelName: 'Model-B' }),
  ]);
  writeProject(home, 'enc1/sess-gamma-0003.jsonl', [
    stepLine({ requestId: 'r5', timestamp: day12 + 1000, input: 300, output: 200, model: 'model-b', modelName: 'Model-B' }),
  ]);
  writeProject(home, 'enc1/sess-delta-0004.jsonl', [
    stepLine({ requestId: 'r6', timestamp: day13, input: 360, output: 240, model: 'model-c', modelName: 'model-c' }),
  ]);
  writeProject(home, 'enc2/sess-missing-0005.jsonl', [
    stepLine({ requestId: 'r7', timestamp: day13 + 1000, input: 420, output: 280, model: 'model-c', modelName: 'model-c' }),
  ]);
  writeProject(home, 'enc1/sess-alpha-0001/subagents/agent-x.jsonl', [
    stepLine({ requestId: 'r3', timestamp: day12 + 2000, input: 240, output: 160 }),
  ]);

  return openFixture(home);
}

function findRow(rows: RequestRow[], requestId: string): RequestRow {
  const row = rows.find((item) => item.requestId === requestId);
  if (!row) {
    throw new Error(`缺少请求 ${requestId}`);
  }
  return row;
}

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
  cleanupTempDirs();
});

describe('AC1 可复算', () => {
  it('多步骤、子代理、无积分记录各取一条与原始记录手算一致', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const rows = getRequests(fixture.db, {}).rows;

    expect(findRow(rows, 'r1')).toMatchObject({
      inputTokens: 150,
      outputTokens: 100,
      cacheReadTokens: 50,
      totalTokens: 250,
      credit: 1.5,
      stepCount: 5,
    });
    expect(findRow(rows, 'r3')).toMatchObject({
      inputTokens: 240,
      outputTokens: 160,
      cacheReadTokens: 0,
      totalTokens: 400,
      credit: 0,
      isSubagent: true,
      session: 'sess-alpha-0001',
      group: '/work/alpha',
    });
    expect(findRow(rows, 'r7')).toMatchObject({
      inputTokens: 420,
      outputTokens: 280,
      totalTokens: 700,
      credit: 0,
      group: '未知分组',
      session: 'sess-missing-0005',
    });
  });
});

describe('AC2 去重生效', () => {
  it('合计等于按请求取最大值之和，且小于步骤直接累加', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const summary = getSummary(fixture.db, {});

    const stepSum = 50 + 100 + 150 + 200 + 250 + 15 + 300 + 500 + 600 + 700 + 400;
    expect(summary.token.totalTokens).toBe(2765);
    expect(summary.token.totalTokens).toBeLessThan(stepSum);
    expect(stepSum / summary.token.totalTokens).toBeGreaterThan(1);
    expect(summary.token.requestCount).toBe(7);
    expect(summary.token.sessionCount).toBe(5);
  });

  it('80 步骤的长链路请求只计一次，步骤累加被放大 30 倍以上', async () => {
    const home = makeTempDir();
    createWorkbuddyDb(home, [], []);
    const stepCount = 80;
    const lines: string[] = [];
    for (let index = 1; index <= stepCount; index += 1) {
      lines.push(
        stepLine({
          requestId: 'long-request',
          timestamp: day11 + index * 1000,
          input: index * 6,
          output: index * 4,
          total: index * 10,
        }),
      );
    }
    writeProject(home, 'enc-long/long.jsonl', lines);

    const fixture = openFixture(home);
    const result = await fixture.refresh();
    expect(result.upsertedRequests).toBe(1);

    const summary = getSummary(fixture.db, {});
    expect(summary.token).toMatchObject({
      totalTokens: 800,
      inputTokens: 480,
      outputTokens: 320,
      requestCount: 1,
    });
    const stepSum = ((stepCount * (stepCount + 1)) / 2) * 10;
    expect(stepSum / summary.token.totalTokens).toBeGreaterThan(30);
  });
});

describe('AC3 维度一致', () => {
  it('分组、模型、对话的 token 与请求数求和都等于总览', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const summary = getSummary(fixture.db, {});

    for (const dimension of ['group', 'model', 'session'] as const) {
      const rows = getBreakdown(fixture.db, {}, dimension).rows;
      expect(rows.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(
        summary.token.totalTokens,
      );
      expect(rows.reduce((sum, row) => sum + row.requestCount, 0)).toBe(
        summary.token.requestCount,
      );
      expect(rows.reduce((sum, row) => sum + row.tokenShare, 0)).toBeCloseTo(1, 10);
      expect(rows.reduce((sum, row) => sum + row.credit, 0)).toBeCloseTo(3.75, 10);
    }

    const groups = getBreakdown(fixture.db, {}, 'group').rows;
    expect(
      Object.fromEntries(groups.map((row) => [row.key, row.totalTokens])),
    ).toMatchObject({
      '/work/alpha': 665,
      '/work/beta': 300,
      '/work/gamma': 500,
      '/work/delta': 600,
      未知分组: 700,
    });
  });
});

describe('AC4 增量刷新', () => {
  it('数据无变化时跳过解析与写入并在 1 秒内完成', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const second = await fixture.refresh();

    expect(second).toMatchObject({ changedFiles: 0, upsertedRequests: 0, creditAttached: 0 });
    expect(second.durationMs).toBeLessThan(1000);
  });
});

describe('AC5 全量重建', () => {
  it('固定夹具全量解析完成且数据库可重建', async () => {
    const fixture = createFixture();
    const result = await fixture.refresh();
    expect(result.durationMs).toBeLessThan(30_000);
    expect(result.scannedFiles).toBe(6);

    fixture.close();
    opened.pop();
    rmSync(fixture.config.databasePath, { force: true });
    const reopened = openDatabase(fixture.config.databasePath);
    const refresher = createRefresher(reopened.db, fixture.config);
    const rebuilt = await refresher.refresh();
    expect(rebuilt.upsertedRequests).toBe(7);
    expect(getSummary(reopened.db, {}).token.totalTokens).toBe(2765);
    closeDatabase(reopened.db);
  });

  it('120 个文件 / 960 个请求的全量解析在 30 秒内完成', async () => {
    const home = makeTempDir();
    createWorkbuddyDb(home, [], []);
    const fileCount = 120;
    const requestsPerFile = 8;
    for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
      const lines: string[] = [];
      for (let requestIndex = 0; requestIndex < requestsPerFile; requestIndex += 1) {
        const requestId = `f${fileIndex}-r${requestIndex}`;
        const timestamp = day11 + requestIndex * 2000;
        lines.push(stepLine({ requestId, timestamp, input: 5, output: 5, total: 10 }));
        lines.push(
          stepLine({ requestId, timestamp: timestamp + 1000, input: 10, output: 10, total: 20 }),
        );
      }
      writeProject(home, `enc${fileIndex}/s${fileIndex}.jsonl`, lines);
    }

    const fixture = openFixture(home);
    const result = await fixture.refresh();
    expect(result.scannedFiles).toBe(fileCount);
    expect(result.upsertedRequests).toBe(fileCount * requestsPerFile);
    expect(result.durationMs).toBeLessThan(30_000);
    expect(getSummary(fixture.db, {}).token).toMatchObject({
      totalTokens: fileCount * requestsPerFile * 20,
      requestCount: fileCount * requestsPerFile,
    });

    const second = await fixture.refresh();
    expect(second.changedFiles).toBe(0);
    expect(second.durationMs).toBeLessThan(1000);
  });
});

describe('AC6 子代理归属', () => {
  it('子代理请求计入总量并归入父会话与分组，积分按 0 计', async () => {
    const fixture = createFixture();
    await fixture.refresh();

    const subagents = getRequests(fixture.db, {}).rows.filter((row) => row.isSubagent);
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({
      requestId: 'r3',
      session: 'sess-alpha-0001',
      sessionName: 'Alpha 会话',
      group: '/work/alpha',
      credit: 0,
    });

    const alpha = getBreakdown(fixture.db, { group: '/work/alpha' }, 'session').rows;
    expect(alpha.find((row) => row.key === 'sess-alpha-0001')?.totalTokens).toBe(665);
  });
});

describe('AC7 空值兜底', () => {
  it('移除会话行并重新解析后分组回退为未知分组，数据不丢、维表行保留', async () => {
    const fixture = createFixture();
    await fixture.refresh();

    const db = externalDb(fixture.home);
    db.prepare("DELETE FROM sessions WHERE id = 'sess-gamma-0003'").run();
    db.close();

    const gammaFile = join(fixture.home, 'projects/enc1/sess-gamma-0003.jsonl');
    appendFileSync(gammaFile, '\n');

    const result = await fixture.refresh();
    expect(result.changedFiles).toBe(1);
    expect(result.failedFiles).toBe(0);

    const row = findRow(getRequests(fixture.db, {}).rows, 'r5');
    expect(row).toMatchObject({ totalTokens: 500, group: '未知分组', session: 'sess-gamma-0003' });

    const kept = fixture.db
      .prepare("SELECT display_name FROM sessions WHERE session_key = 'sess-gamma-0003'")
      .get() as { display_name?: string } | undefined;
    expect(kept?.display_name).toBe('Gamma 会话');
  });
});

describe('AC8 积分合计可用', () => {
  it('积分合计与请求数符合预期', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const summary = getSummary(fixture.db, {});

    expect(summary.credit.requestCount).toBe(7);
    expect(summary.credit.credit).toBeCloseTo(3.75, 10);
    expect(summary.credit).not.toHaveProperty('coverage');
  });
});

describe('AC9 积分独立刷新', () => {
  it('jsonl 未变化时补挂晚到积分', async () => {
    const fixture = createFixture();
    await fixture.refresh();

    const db = externalDb(fixture.home);
    db.prepare("UPDATE session_usage SET credit_json = ? WHERE session_id = 'sess-alpha-0001'").run(
      '{"r1":1.5,"r2":0,"r3":5}',
    );
    db.close();

    const result = await fixture.refresh();
    expect(result).toMatchObject({ changedFiles: 0, creditAttached: 1 });
    expect(findRow(getRequests(fixture.db, {}).rows, 'r3')).toMatchObject({
      credit: 5,
    });
  });
});

describe('AC10 文件原子替换', () => {
  it('移除请求后从视图消失，同文件其它请求数值不变', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const before = findRow(getRequests(fixture.db, {}).rows, 'r1');

    writeProject(fixture.home, 'enc1/sess-alpha-0001.jsonl', [
      stepLine({ requestId: 'r1', timestamp: day11, input: 30, output: 20, cache: 5, total: 50 }),
      stepLine({ requestId: 'r1', timestamp: day11 + 1000, input: 60, output: 40, cache: 10, total: 100 }),
      stepLine({ requestId: 'r1', timestamp: day11 + 2000, input: 90, output: 60, cache: 20, total: 150 }),
      stepLine({ requestId: 'r1', timestamp: day11 + 3000, input: 120, output: 80, cache: 30, total: 200 }),
      stepLine({ requestId: 'r1', timestamp: day11 + 4000, input: 150, output: 100, cache: 50, total: 250 }),
    ]);

    const result = await fixture.refresh();
    expect(result).toMatchObject({ changedFiles: 1, upsertedRequests: 1 });
    const after = getRequests(fixture.db, {}).rows;
    expect(after.map((row) => row.requestId)).not.toContain('r2');
    expect(findRow(after, 'r1')).toEqual(before);
  });

  it('来源文件被移除时清理对应请求，其它请求不变', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const before = getRequests(fixture.db, {}).rows;

    rmSync(join(fixture.home, 'projects/enc1/sess-delta-0004.jsonl'));
    const result = await fixture.refresh();
    expect(result).toMatchObject({ scannedFiles: 5, changedFiles: 0 });

    const after = getRequests(fixture.db, {}).rows;
    expect(after.map((row) => row.requestId)).not.toContain('r6');
    expect(after.length).toBe(before.length - 1);
    for (const row of after) {
      expect(row).toEqual(before.find((item) => item.requestId === row.requestId));
    }
  });
});

describe('AC11 首屏数据完整性', () => {
  it('首屏所需的服务层聚合结果齐全（界面结构由 usage-panel-polish 验收记录覆盖）', async () => {
    const fixture = createFixture();
    await fixture.refresh();
    const summary = getSummary(fixture.db, {});
    const timeseries = getTimeseries(fixture.db, { from: '2026-11-11', to: '2026-11-13' });
    const breakdowns = [
      getBreakdown(fixture.db, {}, 'group'),
      getBreakdown(fixture.db, {}, 'session'),
      getBreakdown(fixture.db, {}, 'model'),
    ];
    const rows = getRequests(fixture.db, {}).rows;

    expect(summary.token.requestCount).toBe(7);
    expect(timeseries).not.toHaveProperty('days');
    expect(new Set(timeseries.rows.map((row) => row.date)).size).toBe(3);
    expect(breakdowns.every((item) => item.rows.length > 0)).toBe(true);
    expect(rows[0]).not.toHaveProperty('hasCredit');
    expect(rows[0]).not.toHaveProperty('id');
  });
});
