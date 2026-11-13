import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { EtlConfig } from '../../src/etl/config.ts';
import { closeIndex, openIndex } from '../../src/etl/index-db.ts';
import { createRefresher } from '../../src/etl/refresh.ts';
import type { Refresher } from '../../src/etl/refresh.ts';
import { createWorkbuddyDb } from './external-db.ts';
import { stepLine } from './jsonl.ts';
import { makeTempDir } from './temp.ts';

export interface SegmentFixture {
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
 * 交叉聚合夹具：alpha 分组由 model-a 300 + model-b 100 两个模型构成，beta 分组只有 model-c 200，
 * 合计 600 token / 3 积分。用于验证「每行分段之和等于行值」与分组键归并。
 */
export async function createSegmentFixture(): Promise<SegmentFixture> {
  const home = makeTempDir();
  createWorkbuddyDb(
    home,
    [
      { id: 's1', cwd: '/work/alpha', title: 'Alpha 会话' },
      { id: 's2', cwd: '/work/beta', title: 'Beta 会话' },
    ],
    [
      { sessionId: 's1', creditJson: '{"a1":1.5,"a2":0.5}' },
      { sessionId: 's2', creditJson: '{"b1":1}' },
    ],
  );

  const day = Date.UTC(2026, 10, 12, 10, 0);

  writeProject(home, 'enc1/s1.jsonl', [
    stepLine({
      requestId: 'a1',
      timestamp: day,
      input: 180,
      output: 120,
      total: 300,
      model: 'model-a',
      modelName: 'Model-A',
    }),
    stepLine({
      requestId: 'a2',
      timestamp: day + 1000,
      input: 60,
      output: 40,
      total: 100,
      model: 'model-b',
      modelName: 'Model-B',
    }),
  ]);
  writeProject(home, 'enc2/s2.jsonl', [
    stepLine({
      requestId: 'b1',
      timestamp: day + 2000,
      input: 120,
      output: 80,
      total: 200,
      model: 'model-c',
      modelName: 'model-c',
    }),
  ]);

  const config: EtlConfig = {
    workbuddyHome: home,
    indexPath: join(home, '.data', 'index.db'),
  };
  const { db } = openIndex(config.indexPath);
  const refresher = createRefresher(db, config);
  return { home, config, db, refresher, close: () => closeIndex(db) };
}
