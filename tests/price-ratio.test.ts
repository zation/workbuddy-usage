import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { getTimeseries } from '../server/query.ts';
import { SCHEMA_SQL } from '../src/etl/index-db.ts';
import { DEEPSEEK_MODEL_KEYS } from '../src/shared/deepseek-pricing.ts';
import type { Filters } from '../src/shared/types.ts';

const DS_KEY = DEEPSEEK_MODEL_KEYS[0] ?? 'deepseek-v4.1-flash';
const DATE = '2026-11-12';

interface RequestSpec {
  requestId: string;
  modelId: number;
  offpeak: number;
  input: number;
  output: number;
  cache: number;
  credit: number;
  date?: string;
}

function makeDb(specs: RequestSpec[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)').run(
    DS_KEY,
    'DeepSeek-V4.1-Flash',
    'DeepSeek-V4.1-Flash',
  );
  db.prepare('INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)').run(
    'model-a',
    'Model-A',
    'Model-A',
  );

  const insert = db.prepare(`
    INSERT INTO requests (
      request_id, group_id, session_id, model_id, source_file_id, is_subagent,
      started_at, ended_at, date_key, is_deepseek_offpeak,
      input_tokens, output_tokens, cache_read_tokens, total_tokens, credit, has_credit, step_count
    ) VALUES (?, 1, 1, ?, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `);
  for (const spec of specs) {
    insert.run(
      spec.requestId,
      spec.modelId,
      spec.date ?? DATE,
      spec.offpeak,
      spec.input,
      spec.output,
      spec.cache,
      spec.input + spec.output,
      spec.credit,
    );
  }
  return db;
}

function ratioFor(db: DatabaseSync, filters: Filters = {}) {
  return getTimeseries(db, filters).ratios;
}

describe('timeseries 的 DS 价格比率', () => {
  it('同一天含高峰与空闲两档时，分子只按当天积分总和乘一次单价', () => {
    const db = makeDb([
      { requestId: 'peak', modelId: 1, offpeak: 0, input: 1_000_000, output: 0, cache: 0, credit: 100 },
      { requestId: 'off', modelId: 1, offpeak: 1, input: 1_000_000, output: 0, cache: 0, credit: 50 },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(1);
    expect(ratios[0]?.date).toBe(DATE);
    expect(ratios[0]?.officialCost).toBeCloseTo(3, 10);
    expect(ratios[0]?.wbCost).toBeCloseTo(150 * (56 / 7000), 10);
    expect(ratios[0]?.ratio).toBeCloseTo(150 * (56 / 7000) / 3, 10);
    db.close();
  });

  it('分母为 0 时 ratio 为 null，分子为 0 时比率如实为 0', () => {
    const db = makeDb([
      { requestId: 'zero-tokens', modelId: 1, offpeak: 1, input: 0, output: 0, cache: 0, credit: 10, date: '2026-11-10' },
      { requestId: 'zero-credit', modelId: 1, offpeak: 1, input: 1_000_000, output: 0, cache: 0, credit: 0, date: '2026-11-11' },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(2);
    expect(ratios[0]?.ratio).toBeNull();
    expect(ratios[1]?.ratio).toBe(0);
    db.close();
  });

  it('模型 / 日期筛选对 ratios 生效，非 DS 模型返回空数组', () => {
    const db = makeDb([
      { requestId: 'ds', modelId: 1, offpeak: 1, input: 1_000_000, output: 0, cache: 0, credit: 100 },
      { requestId: 'other', modelId: 2, offpeak: 1, input: 1_000_000, output: 0, cache: 0, credit: 100, date: '2026-11-13' },
    ]);
    expect(ratioFor(db).map((row) => row.date)).toEqual([DATE]);
    expect(ratioFor(db, { model: 'model-a' })).toEqual([]);
    expect(ratioFor(db, { from: '2026-11-13', to: '2026-11-13' })).toEqual([]);
    expect(ratioFor(db, { to: '2026-11-11' })).toEqual([]);
    db.close();
  });

  it('rows 的形状与语义不变', () => {
    const db = makeDb([
      { requestId: 'ds', modelId: 1, offpeak: 1, input: 600, output: 400, cache: 100, credit: 20 },
    ]);
    const result = getTimeseries(db, {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      date: DATE,
      model: DS_KEY,
      totalTokens: 1000,
      inputTokens: 600,
      outputTokens: 400,
      cacheReadTokens: 100,
      credit: 20,
    });
    db.close();
  });
});

function ratiosInTimezone(tz: string): string {
  const queryUrl = new URL('../server/query.ts', import.meta.url).href;
  const schemaUrl = new URL('../src/etl/index-db.ts', import.meta.url).href;
  const script = [
    `import { DatabaseSync } from 'node:sqlite';`,
    `import { getTimeseries } from '${queryUrl}';`,
    `import { SCHEMA_SQL } from '${schemaUrl}';`,
    `const db = new DatabaseSync(':memory:');`,
    `db.exec(SCHEMA_SQL);`,
    `db.prepare('INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)')`,
    `  .run('deepseek-v4.1-flash', 'DeepSeek', 'DeepSeek');`,
    `const insert = db.prepare('INSERT INTO requests (request_id, group_id, session_id, model_id, source_file_id, is_subagent, started_at, ended_at, date_key, is_deepseek_offpeak, input_tokens, output_tokens, cache_read_tokens, total_tokens, credit, has_credit, step_count) VALUES (?, 1, 1, 1, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 1, 1)');`,
    `insert.run('peak', '2026-11-12', 0, 1000000, 0, 0, 1000000, 100);`,
    `insert.run('offpeak', '2026-11-12', 1, 1000000, 0, 0, 1000000, 50);`,
    `insert.run('cross-month', '2026-10-31', 1, 1000000, 0, 0, 1000000, 20);`,
    `console.log(JSON.stringify(getTimeseries(db, {}).ratios));`,
    `db.close();`,
  ].join('\n');
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

describe('价格比率序列与机器时区无关', () => {
  it('UTC / UTC+8 / UTC-8 得到同一组按天比率（含跨月单价）', () => {
    const expected = ratiosInTimezone('UTC');
    expect(expected).not.toBe('[]');
    expect(expected).toContain('2026-10-31');
    expect(expected).toContain('2026-11-12');
    expect(ratiosInTimezone('Asia/Shanghai')).toBe(expected);
    expect(ratiosInTimezone('America/Los_Angeles')).toBe(expected);
  });
});
