import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { EtlConfig } from '../src/etl/config.ts';
import { closeDatabase, openDatabase } from '../src/etl/database.ts';
import { createRefresher } from '../src/etl/refresh.ts';
import type { RefreshResult } from '../src/shared/types.ts';
import { createWorkbuddyDb } from './helpers/external-db.ts';
import { stepLine } from './helpers/jsonl.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

interface Fixture {
  home: string;
  config: EtlConfig;
  db: DatabaseSync;
  refresh: () => Promise<RefreshResult>;
}

const opened: DatabaseSync[] = [];
const base = Date.UTC(2026, 10, 12, 10, 0);

function writeProject(home: string, relativePath: string, lines: string[]): void {
  const absolute = join(home, 'projects', relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${lines.join('\n')}\n`);
}

function setCreditJson(home: string, sessionId: string, json: string | null): void {
  const db = new DatabaseSync(join(home, 'workbuddy.db'));
  db.prepare('UPDATE session_usage SET credit_json = ? WHERE session_id = ?').run(json, sessionId);
  db.close();
}

function setup(): Fixture {
  const home = makeTempDir();
  createWorkbuddyDb(
    home,
    [
      { id: 's1', cwd: '/work/demo', title: '演示会话' },
      { id: 's2', cwd: '/work/other' },
    ],
    [
      { sessionId: 's1', creditJson: '{"r1":1.5,"r2":0}' },
      { sessionId: 's2', creditJson: null },
    ],
  );
  const config: EtlConfig = {
    workbuddyHome: home,
    databasePath: join(home, '.data', 'database.db'),
  };
  const { db } = openDatabase(config.databasePath);
  opened.push(db);
  return { home, config, db, refresh: createRefresher(db, config).refresh };
}

function rows<T>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

interface JoinedRequest {
  request_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  date_key: string;
  is_subagent: number;
  step_count: number;
  group_path: string;
  session_key: string;
  model: string;
  model_name: string | null;
  display_name: string;
  credit: number;
  has_credit: number;
}

function joinedRequests(db: DatabaseSync): JoinedRequest[] {
  return rows<JoinedRequest>(
    db,
    `SELECT r.request_id, r.total_tokens, r.input_tokens, r.output_tokens, r.cache_read_tokens,
            r.date_key, r.is_subagent, r.step_count, r.credit, r.has_credit,
            g.group_path, s.session_key, m.model, m.model_name, m.display_name
     FROM requests r
     LEFT JOIN groups g ON g.id = r.group_id
     LEFT JOIN sessions s ON s.id = r.session_id
     LEFT JOIN models m ON m.id = r.model_id
     ORDER BY r.request_id`,
  );
}

afterEach(() => {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db) {
      closeDatabase(db);
    }
  }
  cleanupTempDirs();
});

function writeStandardFixture(home: string): void {
  writeProject(home, 'enc1/s1.jsonl', [
    stepLine({ requestId: 'r1', timestamp: base, input: 60, output: 40, cache: 10, total: 100 }),
    stepLine({ requestId: 'r1', timestamp: base + 1000, input: 150, output: 100, cache: 50, total: 250 }),
    stepLine({ requestId: 'r2', timestamp: base + 2000, input: 10, output: 5 }),
  ]);
  writeProject(home, 'enc1/s1/subagents/agent-a.jsonl', [
    stepLine({ requestId: 'r3', timestamp: base + 3000, input: 20, output: 10 }),
  ]);
  writeProject(home, 'enc2/s2.jsonl', [
    stepLine({
      requestId: 'r4',
      timestamp: base + 4000,
      input: 7,
      output: 3,
      model: 'glm-5.2',
      modelName: 'GLM-5.2',
    }),
  ]);
}

describe('刷新编排与文件原子替换', () => {
  it('首次刷新写入请求、维表与扫描状态', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);

    const result = await fixture.refresh();
    expect(result).toMatchObject({
      skipped: false,
      scannedFiles: 3,
      changedFiles: 3,
      upsertedRequests: 4,
      creditAttached: 2,
      failedFiles: 0,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.lastRefreshAt).toBeGreaterThan(0);
    expect(result.warnings.invalidJsonLines).toBe(0);

    const requests = joinedRequests(fixture.db);
    expect(requests.map((row) => row.request_id)).toEqual(['r1', 'r2', 'r3', 'r4']);

    const r1 = requests.find((row) => row.request_id === 'r1');
    expect(r1).toMatchObject({
      total_tokens: 250,
      input_tokens: 150,
      output_tokens: 100,
      cache_read_tokens: 50,
      date_key: '2026-11-12',
      is_subagent: 0,
      step_count: 2,
      group_path: '/work/demo',
      session_key: 's1',
      model: 'model-a',
      display_name: 'Model-A',
      credit: 1.5,
      has_credit: 1,
    });

    const r3 = requests.find((row) => row.request_id === 'r3');
    expect(r3).toMatchObject({ is_subagent: 1, session_key: 's1', group_path: '/work/demo' });

    const r4 = requests.find((row) => row.request_id === 'r4');
    expect(r4).toMatchObject({ model: 'glm-5.2', display_name: 'GLM-5.2', group_path: '/work/other' });

    expect(
      rows<{ session_key: string; display_name: string }>(
        fixture.db,
        'SELECT session_key, display_name FROM sessions ORDER BY session_key',
      ),
    ).toEqual([
      { session_key: 's1', display_name: '演示会话' },
      { session_key: 's2', display_name: 's2' },
    ]);

    const sourceFiles = rows<{ path: string; kind: string; size_bytes: number; mtime_ms: number }>(
      fixture.db,
      'SELECT path, kind, size_bytes, mtime_ms FROM source_files ORDER BY path',
    );
    expect(sourceFiles).toHaveLength(3);
    expect(sourceFiles.map((row) => row.kind).sort()).toEqual(['main', 'main', 'subagent']);
    const s1Path = join(fixture.home, 'projects/enc1/s1.jsonl');
    const s1Row = sourceFiles.find((row) => row.path === s1Path);
    expect(s1Row?.size_bytes).toBe(statSync(s1Path).size);
    expect(s1Row?.mtime_ms).toBe(Math.floor(statSync(s1Path).mtimeMs));

    expect(
      rows<{ last_refresh_at: number }>(fixture.db, 'SELECT last_refresh_at FROM meta'),
    ).toEqual([{ last_refresh_at: result.lastRefreshAt }]);
  });

  it('增量刷新只解析部分文件时展示名不回退（R8）', async () => {
    const fixture = setup();
    writeProject(fixture.home, 'enc1/s1.jsonl', [
      stepLine({
        requestId: 'r1',
        timestamp: base,
        input: 10,
        output: 5,
        model: 'hy4',
        modelName: 'Hy4',
      }),
    ]);
    writeProject(fixture.home, 'enc2/s2.jsonl', [
      stepLine({
        requestId: 'r2',
        timestamp: base + 1000,
        input: 10,
        output: 5,
        model: 'hy4-free',
        modelName: 'Hy4',
      }),
    ]);

    await fixture.refresh();
    const before = rows<{ model: string; display_name: string }>(
      fixture.db,
      'SELECT model, display_name FROM models ORDER BY model',
    );
    expect(before).toEqual([
      { model: 'hy4', display_name: 'Hy4' },
      { model: 'hy4-free', display_name: 'Hy4 (hy4-free)' },
    ]);

    writeProject(fixture.home, 'enc2/s2.jsonl', [
      stepLine({
        requestId: 'r2',
        timestamp: base + 1000,
        input: 10,
        output: 5,
        model: 'hy4-free',
        modelName: 'Hy4',
      }),
      stepLine({
        requestId: 'r3',
        timestamp: base + 2000,
        input: 10,
        output: 5,
        model: 'hy4-free',
        modelName: 'Hy4',
      }),
    ]);

    const second = await fixture.refresh();
    expect(second.changedFiles).toBe(1);
    expect(
      rows<{ model: string; display_name: string }>(
        fixture.db,
        'SELECT model, display_name FROM models ORDER BY model',
      ),
    ).toEqual(before);
  });

  it('数据无变化时跳过重解析与写入（AC4）', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);
    const first = await fixture.refresh();
    const before = joinedRequests(fixture.db);

    const second = await fixture.refresh();
    expect(second).toMatchObject({
      skipped: false,
      scannedFiles: 3,
      changedFiles: 0,
      upsertedRequests: 0,
      failedFiles: 0,
    });
    expect(second.durationMs).toBeLessThan(1000);
    expect(second.lastRefreshAt).toBeGreaterThan(0);
    expect(first.lastRefreshAt).toBeLessThanOrEqual(second.lastRefreshAt ?? 0);
    expect(joinedRequests(fixture.db)).toEqual(before);
  });

  it('文件内容变化时整文件原子替换，消失的请求不残留（AC10）', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);
    await fixture.refresh();
    const before = joinedRequests(fixture.db).find((row) => row.request_id === 'r1');

    writeProject(fixture.home, 'enc1/s1.jsonl', [
      stepLine({ requestId: 'r1', timestamp: base, input: 60, output: 40, cache: 10, total: 100 }),
      stepLine({ requestId: 'r1', timestamp: base + 1000, input: 150, output: 100, cache: 50, total: 250 }),
    ]);

    const result = await fixture.refresh();
    expect(result).toMatchObject({ changedFiles: 1, upsertedRequests: 1, failedFiles: 0 });

    const after = joinedRequests(fixture.db);
    expect(after.map((row) => row.request_id)).toEqual(['r1', 'r3', 'r4']);
    expect(after.find((row) => row.request_id === 'r1')).toEqual(before);
  });

  it('来源文件被删除时清理对应请求（C8）', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);
    await fixture.refresh();

    rmSync(join(fixture.home, 'projects/enc2/s2.jsonl'));
    const result = await fixture.refresh();
    expect(result).toMatchObject({ scannedFiles: 2, changedFiles: 0, failedFiles: 0 });

    expect(joinedRequests(fixture.db).map((row) => row.request_id)).toEqual(['r1', 'r2', 'r3']);
    expect(
      rows<{ n: number }>(fixture.db, 'SELECT COUNT(*) AS n FROM source_files'),
    ).toEqual([{ n: 2 }]);
  });

  it('同一请求跨文件只保留一行并记录告警（R11 / C1）', async () => {
    const fixture = setup();
    writeProject(fixture.home, 'enc1/share-a.jsonl', [
      stepLine({ requestId: 'dup', timestamp: base, input: 10, output: 5 }),
    ]);
    writeProject(fixture.home, 'enc2/share-b.jsonl', [
      stepLine({ requestId: 'dup', timestamp: base, input: 10, output: 5 }),
    ]);

    const result = await fixture.refresh();
    expect(result.warnings.duplicateRequestIds).toBe(1);
    expect(joinedRequests(fixture.db).map((row) => row.request_id)).toEqual(['dup']);
    expect(
      rows<{ n: number }>(fixture.db, "SELECT COUNT(*) AS n FROM requests WHERE request_id = 'dup'"),
    ).toEqual([{ n: 1 }]);
  });

  it('并发触发只执行一次，后到调用标记 skipped', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);

    const firstPromise = fixture.refresh();
    const secondPromise = fixture.refresh();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second.lastRefreshAt).toBe(first.lastRefreshAt);
    expect(second.upsertedRequests).toBe(first.upsertedRequests);
    expect(joinedRequests(fixture.db)).toHaveLength(4);
  });

  it('非法 JSON 行只告警，不阻断其余记录', async () => {
    const fixture = setup();
    writeProject(fixture.home, 'enc1/bad.jsonl', [
      '{"truncated": ',
      stepLine({ requestId: 'ok', timestamp: base, input: 1, output: 1 }),
    ]);

    const result = await fixture.refresh();
    expect(result.warnings.invalidJsonLines).toBe(1);
    expect(result.failedFiles).toBe(0);
    expect(joinedRequests(fixture.db).map((row) => row.request_id)).toEqual(['ok']);
  });

  it('积分晚到补挂、值修正，映射消失不主动清零（AC9 / C6）', async () => {
    const fixture = setup();
    writeStandardFixture(fixture.home);
    await fixture.refresh();

    const baseline = joinedRequests(fixture.db);
    expect(baseline.find((row) => row.request_id === 'r2')).toMatchObject({
      credit: 0,
      has_credit: 1,
    });
    expect(baseline.find((row) => row.request_id === 'r3')).toMatchObject({
      credit: 0,
      has_credit: 0,
    });

    setCreditJson(fixture.home, 's1', '{"r1":2.25,"r2":0,"r3":3}');
    const late = await fixture.refresh();
    expect(late).toMatchObject({ changedFiles: 0, creditAttached: 2 });

    const afterLate = joinedRequests(fixture.db);
    expect(afterLate.find((row) => row.request_id === 'r1')).toMatchObject({
      credit: 2.25,
      has_credit: 1,
    });
    expect(afterLate.find((row) => row.request_id === 'r2')).toMatchObject({
      credit: 0,
      has_credit: 1,
    });
    expect(afterLate.find((row) => row.request_id === 'r3')).toMatchObject({
      credit: 3,
      has_credit: 1,
    });
    expect(afterLate.find((row) => row.request_id === 'r4')).toMatchObject({
      credit: 0,
      has_credit: 0,
    });

    setCreditJson(fixture.home, 's1', null);
    const cleared = await fixture.refresh();
    expect(cleared.creditAttached).toBe(0);
    expect(joinedRequests(fixture.db)).toEqual(afterLate);
  });

  it.skipIf(process.platform === 'win32')(
    '解析失败不推进扫描状态，恢复可读后重试成功（C9）',
    async () => {
      const fixture = setup();
      const path = join(fixture.home, 'projects/enc1/s1.jsonl');
      writeProject(fixture.home, 'enc1/s1.jsonl', [
        stepLine({ requestId: 'r1', timestamp: base, input: 1, output: 1 }),
      ]);
      await fixture.refresh();
      const before = rows<{ size_bytes: number; mtime_ms: number }>(
        fixture.db,
        'SELECT size_bytes, mtime_ms FROM source_files WHERE path = ?',
        path,
      );

      writeFileSync(
        path,
        `${[
          stepLine({ requestId: 'r1', timestamp: base, input: 1, output: 1 }),
          stepLine({ requestId: 'r2', timestamp: base + 1000, input: 2, output: 2 }),
        ].join('\n')}\n`,
      );
      chmodSync(path, 0o000);

      const failed = await fixture.refresh();
      expect(failed.failedFiles).toBe(1);
      expect(joinedRequests(fixture.db).map((row) => row.request_id)).toEqual(['r1']);
      expect(
        rows<{ size_bytes: number; mtime_ms: number }>(
          fixture.db,
          'SELECT size_bytes, mtime_ms FROM source_files WHERE path = ?',
          path,
        ),
      ).toEqual(before);

      chmodSync(path, 0o644);
      const recovered = await fixture.refresh();
      expect(recovered.failedFiles).toBe(0);
      expect(joinedRequests(fixture.db).map((row) => row.request_id)).toEqual(['r1', 'r2']);
    },
  );
});
