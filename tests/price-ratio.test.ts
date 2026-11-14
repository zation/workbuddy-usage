import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { getTimeseries } from '../server/query.ts';
import { SCHEMA_SQL } from '../src/etl/database.ts';
import { DEEPSEEK_MODEL_KEYS } from '../src/shared/deepseek-pricing.ts';
import type { Filters } from '../src/shared/types.ts';

const DS_KEY = DEEPSEEK_MODEL_KEYS[0] ?? 'deepseek-v4.1-flash';
const DATE = '2026-11-12';

interface StepSpec {
  offpeak: number;
  input: number;
  output: number;
  cache: number;
}

interface RequestSpec {
  requestId: string;
  modelId: number;
  steps: StepSpec[];
  credit: number;
  date?: string;
}

const REQUEST_INSERT = `
  INSERT INTO requests (
    request_id, group_id, session_id, model_id, source_file_id, is_subagent,
    started_at, ended_at, date_key,
    input_tokens, output_tokens, cache_read_tokens, total_tokens, credit, has_credit, step_count
  ) VALUES (?, 1, 1, ?, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, 1, ?)
`;

const STEP_INSERT = `
  INSERT INTO steps (
    request_id, source_file_id, step_index, timestamp, model, is_subagent,
    is_deepseek_offpeak, input_tokens, output_tokens, cache_read_tokens, total_tokens
  ) VALUES (?, 1, ?, 0, ?, 0, ?, ?, ?, ?, ?)
`;

function makeDb(specs: RequestSpec[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO groups (id, group_path, display_name) VALUES (1, ?, ?)').run(
    '/work/demo',
    'demo',
  );
  db.prepare('INSERT INTO sessions (id, session_key, display_name) VALUES (1, ?, ?)').run(
    's1',
    'S1',
  );
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

  const insertRequest = db.prepare(REQUEST_INSERT);
  const insertStep = db.prepare(STEP_INSERT);

  for (const spec of specs) {
    const sum = spec.steps.reduce(
      (acc, step) => ({
        input: acc.input + step.input,
        output: acc.output + step.output,
        cache: acc.cache + step.cache,
      }),
      { input: 0, output: 0, cache: 0 },
    );
    insertRequest.run(
      spec.requestId,
      spec.modelId,
      spec.date ?? DATE,
      sum.input,
      sum.output,
      sum.cache,
      sum.input + sum.output,
      spec.credit,
      spec.steps.length,
    );
    spec.steps.forEach((step, index) => {
      insertStep.run(
        spec.requestId,
        index,
        spec.modelId === 1 ? DS_KEY : 'model-a',
        step.offpeak,
        step.input,
        step.output,
        step.cache,
        step.input + step.output,
      );
    });
  }
  return db;
}

function ratioFor(db: DatabaseSync, filters: Filters = {}) {
  return getTimeseries(db, filters).ratios;
}

const millionInput = (offpeak: number): StepSpec => ({
  offpeak,
  input: 1_000_000,
  output: 0,
  cache: 0,
});

describe('timeseries 的 DS 价格比率', () => {
  it('同一天含高峰与空闲两档时，分子只按当天积分总和乘一次单价', () => {
    const db = makeDb([
      { requestId: 'peak', modelId: 1, steps: [millionInput(0)], credit: 100 },
      { requestId: 'off', modelId: 1, steps: [millionInput(1)], credit: 50 },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(1);
    expect(ratios[0]?.date).toBe(DATE);
    expect(ratios[0]?.officialCost).toBeCloseTo(3, 10);
    expect(ratios[0]?.wbCost).toBeCloseTo(150 * (56 / 7000), 10);
    expect(ratios[0]?.ratio).toBeCloseTo((150 * (56 / 7000)) / 3, 10);
    db.close();
  });

  it('多步 DS 请求不放大分子，跨档步骤按各自档位计价', () => {
    const db = makeDb([
      {
        requestId: 'multi',
        modelId: 1,
        credit: 100,
        steps: [
          millionInput(0),
          { offpeak: 0, input: 500_000, output: 0, cache: 0 },
          millionInput(1),
        ],
      },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(1);
    expect(ratios[0]?.officialCost).toBeCloseTo(4, 10);
    expect(ratios[0]?.wbCost).toBeCloseTo(100 * (56 / 7000), 10);
    expect(ratios[0]?.ratio).toBeCloseTo((100 * (56 / 7000)) / 4, 10);
    db.close();
  });

  it('分母为 0 时 ratio 为 null，分子为 0 时比率如实为 0', () => {
    const db = makeDb([
      {
        requestId: 'zero-tokens',
        modelId: 1,
        steps: [{ offpeak: 1, input: 0, output: 0, cache: 0 }],
        credit: 10,
        date: '2026-11-10',
      },
      { requestId: 'zero-credit', modelId: 1, steps: [millionInput(1)], credit: 0, date: '2026-11-11' },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(2);
    expect(ratios[0]?.ratio).toBeNull();
    expect(ratios[1]?.ratio).toBe(0);
    db.close();
  });

  it('跨月区间各天用各自自然月单价', () => {
    const db = makeDb([
      { requestId: 'oct', modelId: 1, steps: [millionInput(1)], credit: 100, date: '2026-10-31' },
      { requestId: 'nov', modelId: 1, steps: [millionInput(1)], credit: 100, date: '2026-11-01' },
    ]);
    const ratios = ratioFor(db);
    expect(ratios.map((row) => row.date)).toEqual(['2026-10-31', '2026-11-01']);
    expect(ratios[0]?.wbCost).toBeCloseTo(100 * (56 / (4000 + 100 * 31)), 10);
    expect(ratios[1]?.wbCost).toBeCloseTo(100 * (56 / (4000 + 100 * 30)), 10);
    db.close();
  });

  it('四个筛选对分子分母同时生效，无 DS 请求时 ratios 为空数组', () => {
    const db = makeDb([
      { requestId: 'ds', modelId: 1, steps: [millionInput(1)], credit: 100 },
      { requestId: 'other', modelId: 2, steps: [millionInput(1)], credit: 100, date: '2026-11-13' },
    ]);
    const all = ratioFor(db);
    expect(all.map((row) => row.date)).toEqual([DATE]);
    expect(ratioFor(db, { group: '/work/demo' })).toEqual(all);
    expect(ratioFor(db, { session: 's1' })).toEqual(all);
    expect(ratioFor(db, { from: '2026-11-13', to: '2026-11-13' })).toEqual([]);
    expect(ratioFor(db, { to: '2026-11-11' })).toEqual([]);
    expect(ratioFor(db, { group: '/other' })).toEqual([]);
    expect(ratioFor(db, { session: 'other' })).toEqual([]);
    expect(ratioFor(db, { model: 'model-a' })).toEqual([]);

    const withoutDs = makeDb([
      { requestId: 'only-other', modelId: 2, steps: [millionInput(1)], credit: 100 },
    ]);
    expect(ratioFor(withoutDs)).toEqual([]);
    withoutDs.close();
    db.close();
  });

  it('按步分档计价后，闲时组与高峰组的比率自洽（AC4）', () => {
    const db = makeDb([
      { requestId: 'off', modelId: 1, steps: [millionInput(1)], credit: 100, date: '2026-11-11' },
      { requestId: 'peak', modelId: 1, steps: [millionInput(0)], credit: 200, date: '2026-11-12' },
    ]);
    const ratios = ratioFor(db);
    expect(ratios).toHaveLength(2);
    expect(ratios[0]?.officialCost).toBeCloseTo(1, 10);
    expect(ratios[1]?.officialCost).toBeCloseTo(2, 10);
    expect(ratios[0]?.ratio).toBeCloseTo(ratios[1]?.ratio ?? 0, 10);
    db.close();
  });

  it('rows 的形状与语义不变', () => {
    const db = makeDb([
      {
        requestId: 'ds',
        modelId: 1,
        steps: [{ offpeak: 1, input: 600, output: 400, cache: 100 }],
        credit: 20,
      },
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
  const schemaUrl = new URL('../src/etl/database.ts', import.meta.url).href;
  const script = [
    `import { DatabaseSync } from 'node:sqlite';`,
    `import { getTimeseries } from '${queryUrl}';`,
    `import { SCHEMA_SQL } from '${schemaUrl}';`,
    `const db = new DatabaseSync(':memory:');`,
    `db.exec(SCHEMA_SQL);`,
    `db.prepare('INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)')`,
    `  .run('deepseek-v4.1-flash', 'DeepSeek', 'DeepSeek');`,
    `const insertRequest = db.prepare('INSERT INTO requests (request_id, group_id, session_id, model_id, source_file_id, is_subagent, started_at, ended_at, date_key, input_tokens, output_tokens, cache_read_tokens, total_tokens, credit, has_credit, step_count) VALUES (?, 1, 1, 1, 1, 0, 0, 0, ?, ?, ?, ?, ?, ?, 1, ?)');`,
    `const insertStep = db.prepare('INSERT INTO steps (request_id, source_file_id, step_index, timestamp, model, is_subagent, is_deepseek_offpeak, input_tokens, output_tokens, cache_read_tokens, total_tokens) VALUES (?, 1, ?, 0, ?, 0, ?, ?, ?, ?, ?)');`,
    `insertRequest.run('peak', '2026-11-12', 1000000, 0, 0, 1000000, 100, 1);`,
    `insertStep.run('peak', 0, 'deepseek-v4.1-flash', 0, 1000000, 0, 0, 1000000);`,
    `insertRequest.run('offpeak', '2026-11-12', 1000000, 0, 0, 1000000, 50, 1);`,
    `insertStep.run('offpeak', 0, 'deepseek-v4.1-flash', 1, 1000000, 0, 0, 1000000);`,
    `insertRequest.run('cross-month', '2026-10-31', 1000000, 0, 0, 1000000, 20, 1);`,
    `insertStep.run('cross-month', 0, 'deepseek-v4.1-flash', 1, 1000000, 0, 0, 1000000);`,
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
