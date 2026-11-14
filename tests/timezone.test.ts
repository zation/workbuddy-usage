import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const datesUrl = new URL('../src/shared/dates.ts', import.meta.url).href;
const filtersUrl = new URL('../src/web/filters.ts', import.meta.url).href;
const formatUrl = new URL('../src/web/format.ts', import.meta.url).href;
const offpeakUrl = new URL('../src/shared/deepseek-offpeak.ts', import.meta.url).href;

const UTC_BEFORE_MIDNIGHT = Date.UTC(2026, 10, 11, 16, 5);

/** 北京时间 2026-11-12 的 UTC+8 零点与 09 / 12 / 14 / 18 峰谷边界，全部是绝对时间戳。 */
const beijing = (hour: number, minute = 0) => Date.UTC(2026, 10, 12, hour - 8, minute);
const STEP_TIMESTAMPS = [
  beijing(0, 0),
  beijing(8, 59),
  beijing(9, 0),
  beijing(11, 59),
  beijing(12, 0),
  beijing(13, 59),
  beijing(14, 0),
  beijing(17, 59),
  beijing(18, 0),
];

function snapshotInTimezone(tz: string): unknown[] {
  const script = `
    import { toDateKey } from '${datesUrl}';
    import { todayKey } from '${filtersUrl}';
    import { formatDateTime, formatRefreshTime } from '${formatUrl}';
    import { isDeepseekOffpeak } from '${offpeakUrl}';
    const fixed = ${UTC_BEFORE_MIDNIGHT};
    const stamps = ${JSON.stringify(STEP_TIMESTAMPS)};
    console.log(JSON.stringify([
      toDateKey(fixed),
      todayKey(fixed),
      formatDateTime(fixed),
      formatRefreshTime(fixed),
      ...stamps.map((stamp) => [
        toDateKey(stamp),
        Number(isDeepseekOffpeak(stamp)),
        formatDateTime(stamp),
      ]),
    ]));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(output.trim()) as unknown[];
}

describe('时间口径与机器时区无关', () => {
  it('UTC / UTC+8 / UTC-8 得到同一组业务日期、逐步档位与显示', () => {
    const expected = [
      '2026-11-12',
      '2026-11-12',
      '11-12 00:05',
      '00:05',
      ['2026-11-12', 1, '11-12 00:00'],
      ['2026-11-12', 1, '11-12 08:59'],
      ['2026-11-12', 0, '11-12 09:00'],
      ['2026-11-12', 0, '11-12 11:59'],
      ['2026-11-12', 1, '11-12 12:00'],
      ['2026-11-12', 1, '11-12 13:59'],
      ['2026-11-12', 0, '11-12 14:00'],
      ['2026-11-12', 0, '11-12 17:59'],
      ['2026-11-12', 1, '11-12 18:00'],
    ];
    expect(snapshotInTimezone('UTC')).toEqual(expected);
    expect(snapshotInTimezone('Asia/Shanghai')).toEqual(expected);
    expect(snapshotInTimezone('America/Los_Angeles')).toEqual(expected);
  });
});
