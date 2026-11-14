import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { EtlConfig } from '../../src/etl/config.ts';
import { closeDatabase, openDatabase } from '../../src/etl/database.ts';
import { createRefresher } from '../../src/etl/refresh.ts';
import type { Refresher } from '../../src/etl/refresh.ts';
import { createWorkbuddyDb } from './external-db.ts';
import { stepLine } from './jsonl.ts';
import { makeTempDir } from './temp.ts';

export interface StatsFixture {
  home: string;
  config: EtlConfig;
  db: DatabaseSync;
  refresher: Refresher;
  close: () => void;
}

function writeProject(home: string, relativePath: string, lines: string[]): void {
  const absolute = join(home, 'projects', relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${lines.join('\n')}\n`);
}

/**
 * 固定夹具：3 个分组、3 个会话、3 个模型、5 个请求（含 1 个子代理），
 * token 合计 1500、积分合计 3.75、覆盖率 3/5，日期跨 11-11 至 11-13。
 */
export async function createStatsFixture(): Promise<StatsFixture> {
  const home = makeTempDir();
  createWorkbuddyDb(
    home,
    [
      { id: 's1', cwd: '/work/alpha', title: 'Alpha 会话' },
      { id: 's2', cwd: '/work/beta', customTitle: '自定义 Beta' },
      { id: 's3', cwd: '/work/gamma' },
    ],
    [
      { sessionId: 's1', creditJson: '{"a1":1.5,"a2":0}' },
      { sessionId: 's2', creditJson: '{"b1":2.25}' },
      { sessionId: 's3', creditJson: null },
    ],
  );

  const day11 = new Date(2026, 10, 11, 10, 0).getTime();
  const day12 = new Date(2026, 10, 12, 10, 0).getTime();
  const day13 = new Date(2026, 10, 13, 10, 0).getTime();

  writeProject(home, 'enc1/s1.jsonl', [
    stepLine({
      requestId: 'a1',
      timestamp: day11,
      input: 60,
      output: 40,
      cache: 10,
      total: 100,
      model: 'model-a',
      modelName: 'Model-A',
    }),
    stepLine({
      requestId: 'a2',
      timestamp: day12,
      input: 120,
      output: 80,
      total: 200,
      model: 'model-a',
      modelName: 'Model-A',
    }),
  ]);
  writeProject(home, 'enc1/s2.jsonl', [
    stepLine({
      requestId: 'b1',
      timestamp: day12,
      input: 90,
      output: 60,
      total: 150,
      model: 'model-b',
      modelName: 'Model-B',
    }),
    stepLine({
      requestId: 'b1',
      timestamp: day12 + 1000,
      input: 180,
      output: 120,
      total: 300,
      model: 'model-b',
      modelName: 'Model-B',
    }),
  ]);
  writeProject(home, 'enc1/s1/subagents/agent-x.jsonl', [
    stepLine({
      requestId: 'c1',
      timestamp: day13,
      input: 240,
      output: 160,
      total: 400,
      model: 'model-a',
      modelName: 'Model-A',
    }),
  ]);
  writeProject(home, 'enc2/s3.jsonl', [
    stepLine({
      requestId: 'd1',
      timestamp: day13 + 2000,
      input: 300,
      output: 200,
      total: 500,
      model: 'model-c',
      modelName: 'model-c',
    }),
  ]);

  const config: EtlConfig = {
    workbuddyHome: home,
    databasePath: join(home, '.data', 'database.db'),
  };
  const { db } = openDatabase(config.databasePath);
  const refresher = createRefresher(db, config);
  return { home, config, db, refresher, close: () => closeDatabase(db) };
}
