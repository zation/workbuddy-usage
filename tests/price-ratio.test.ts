import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { getTimeseries } from '../server/query.ts';
import { SCHEMA_SQL, SCHEMA_VERSION, closeDatabase, openDatabase } from '../src/etl/database.ts';
import type { HolidayCalendar } from '../src/shared/china-holidays.ts';
import { isDeepseekOffpeak } from '../src/shared/deepseek-offpeak.ts';
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

function populate(db: DatabaseSync, specs: RequestSpec[]): void {
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
}

function makeDb(specs: RequestSpec[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  populate(db, specs);
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

  it('节假日表更新并递增版本重建后，历史比率按新表一致变化（AD-P2 / R8）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-holiday-'));
    const dbPath = join(dir, 'database.db');
    const calendarBefore: HolidayCalendar = { coveredYears: [2026], holidays: new Set() };
    const calendarAfter: HolidayCalendar = {
      coveredYears: [2026],
      holidays: new Set(['2026-11-12']),
    };
    const peak = (day: number): number => Date.UTC(2026, 10, day, 2, 0);
    const specsFor = (calendar: HolidayCalendar): RequestSpec[] =>
      [11, 12].map((day) => ({
        requestId: `d${day}`,
        modelId: 1,
        date: `2026-11-${day}`,
        credit: 100,
        steps: [0, 1].map((offset) => ({
          offpeak: Number(isDeepseekOffpeak(peak(day) + offset * 3_600_000, calendar)),
          input: 1_000_000,
          output: 0,
          cache: 0,
        })),
      }));
    const ratiosByDate = (db: DatabaseSync): Map<string, number | null> =>
      new Map(ratioFor(db).map((row) => [row.date, row.ratio]));
    const mustRatio = (ratios: Map<string, number | null>, date: string): number => {
      const value = ratios.get(date);
      expect(value, `${date} 应有比率`).not.toBeNull();
      return value as number;
    };

    const opened: DatabaseSync[] = [];
    const closeAll = (): void => {
      while (opened.length > 0) {
        const db = opened.pop();
        if (db) {
          closeDatabase(db);
        }
      }
    };

    try {
      expect(isDeepseekOffpeak(peak(12), calendarBefore)).toBe(false);
      expect(isDeepseekOffpeak(peak(12), calendarAfter)).toBe(true);
      expect(isDeepseekOffpeak(peak(11), calendarAfter)).toBe(false);

      const first = openDatabase(dbPath).db;
      opened.push(first);
      populate(first, specsFor(calendarBefore));
      const before = ratiosByDate(first);
      expect(mustRatio(before, '2026-11-11')).toBeCloseTo(mustRatio(before, '2026-11-12'), 10);

      first.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(SCHEMA_VERSION - 1);
      closeAll();

      const rebuilt = openDatabase(dbPath);
      expect(rebuilt.rebuilt).toBe(true);
      opened.push(rebuilt.db);
      expect(rebuilt.db.prepare('SELECT COUNT(*) AS n FROM steps').get()).toEqual({ n: 0 });

      populate(rebuilt.db, specsFor(calendarAfter));
      const after = ratiosByDate(rebuilt.db);
      expect(mustRatio(after, '2026-11-12')).toBeCloseTo(
        2 * mustRatio(before, '2026-11-12'),
        10,
      );
      expect(mustRatio(after, '2026-11-11')).toBeCloseTo(mustRatio(before, '2026-11-11'), 10);

      const flags = rebuilt.db
        .prepare(
          'SELECT request_id, is_deepseek_offpeak AS offpeak FROM steps ORDER BY request_id, step_index',
        )
        .all() as Array<{ request_id: string; offpeak: number }>;
      expect(flags.filter((row) => row.request_id === 'd11').map((row) => row.offpeak)).toEqual([
        0, 0,
      ]);
      expect(flags.filter((row) => row.request_id === 'd12').map((row) => row.offpeak)).toEqual([
        1, 1,
      ]);
    } finally {
      closeAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function ratiosInTimezone(tz: string): string {
  const queryUrl = new URL('../server/query.ts', import.meta.url).href;
  const schemaUrl = new URL('../src/etl/database.ts', import.meta.url).href;
  const datesUrl = new URL('../src/shared/dates.ts', import.meta.url).href;
  const offpeakUrl = new URL('../src/shared/deepseek-offpeak.ts', import.meta.url).href;
  const formatUrl = new URL('../src/web/format.ts', import.meta.url).href;
  const script = [
    `import { DatabaseSync } from 'node:sqlite';`,
    `import { getTimeseries } from '${queryUrl}';`,
    `import { SCHEMA_SQL } from '${schemaUrl}';`,
    `import { toDateKey } from '${datesUrl}';`,
    `import { isDeepseekOffpeak } from '${offpeakUrl}';`,
    `import { formatDateTime } from '${formatUrl}';`,
    `const db = new DatabaseSync(':memory:');`,
    `db.exec(SCHEMA_SQL);`,
    `db.prepare('INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)')`,
    `  .run('deepseek-v4.1-flash', 'DeepSeek', 'DeepSeek');`,
    `const insertRequest = db.prepare('INSERT INTO requests (request_id, group_id, session_id, model_id, source_file_id, is_subagent, started_at, ended_at, date_key, input_tokens, output_tokens, cache_read_tokens, total_tokens, credit, has_credit, step_count) VALUES (?, 1, 1, 1, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)');`,
    `const insertStep = db.prepare('INSERT INTO steps (request_id, source_file_id, step_index, timestamp, model, is_subagent, is_deepseek_offpeak, input_tokens, output_tokens, cache_read_tokens, total_tokens) VALUES (?, 1, ?, ?, ?, 0, ?, ?, ?, ?, ?)');`,
    `const beijing = (day, hour, minute = 0) => Date.UTC(2026, 10, day, hour - 8, minute);`,
    `const stamps = [beijing(12, 0, 0), beijing(12, 8, 59), beijing(12, 9, 0), beijing(12, 11, 59), beijing(12, 12, 0), beijing(12, 13, 59), beijing(12, 14, 0), beijing(12, 17, 59), beijing(12, 18, 0)];`,
    `const cross = Date.UTC(2026, 9, 31, 2, 0);`,
    `const write = (requestId, stamp, credit) => {`,
    `  insertRequest.run(requestId, stamp, stamp, toDateKey(stamp), 1000000, 0, 0, 1000000, credit);`,
    `  insertStep.run(requestId, 0, stamp, 'deepseek-v4.1-flash', Number(isDeepseekOffpeak(stamp)), 1000000, 0, 0, 1000000);`,
    `};`,
    `stamps.forEach((stamp, index) => write('edge-' + index, stamp, 10));`,
    `write('cross-month', cross, 20);`,
    `const series = getTimeseries(db, {});`,
    `console.log(JSON.stringify({`,
    `  dateKeys: stamps.map(toDateKey),`,
    `  offpeakFlags: stamps.map((stamp) => Number(isDeepseekOffpeak(stamp))),`,
    `  formatted: stamps.map(formatDateTime),`,
    `  rows: series.rows.map((row) => [row.date, row.model, row.totalTokens]),`,
    `  ratios: series.ratios,`,
    `}));`,
    `db.close();`,
  ].join('\n');
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

describe('价格比率序列与机器时区无关', () => {
  it('UTC / UTC+8 / UTC-8 得到同一组业务日期、每步档位、比率与格式化', () => {
    const expected = ratiosInTimezone('UTC');
    const parsed = JSON.parse(expected) as {
      dateKeys: string[];
      offpeakFlags: number[];
      formatted: string[];
      ratios: Array<{ date: string }>;
    };
    expect(parsed.dateKeys.every((key) => key === '2026-11-12')).toBe(true);
    expect(parsed.offpeakFlags).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1]);
    expect(parsed.formatted[0]).toBe('11-12 00:00');
    expect(parsed.ratios.map((row) => row.date)).toEqual(['2026-10-31', '2026-11-12']);
    expect(ratiosInTimezone('Asia/Shanghai')).toBe(expected);
    expect(ratiosInTimezone('America/Los_Angeles')).toBe(expected);
  });
});
