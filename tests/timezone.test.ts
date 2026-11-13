import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const datesUrl = new URL('../src/shared/dates.ts', import.meta.url).href;
const filtersUrl = new URL('../src/web/filters.ts', import.meta.url).href;
const formatUrl = new URL('../src/web/format.ts', import.meta.url).href;

const UTC_BEFORE_MIDNIGHT = Date.UTC(2026, 10, 11, 16, 5);

function snapshotInTimezone(tz: string): string[] {
  const script = `
    import { toDateKey } from '${datesUrl}';
    import { todayKey } from '${filtersUrl}';
    import { formatDateTime, formatRefreshTime } from '${formatUrl}';
    const fixed = ${UTC_BEFORE_MIDNIGHT};
    console.log(JSON.stringify([
      toDateKey(fixed),
      todayKey(fixed),
      formatDateTime(fixed),
      formatRefreshTime(fixed),
    ]));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(output.trim()) as string[];
}

describe('时间口径与机器时区无关', () => {
  it('UTC / UTC+8 / UTC-8 得到同一组业务日期与显示', () => {
    const expected = ['2026-11-12', '2026-11-12', '11-12 00:05', '00:05'];
    expect(snapshotInTimezone('UTC')).toEqual(expected);
    expect(snapshotInTimezone('Asia/Shanghai')).toEqual(expected);
    expect(snapshotInTimezone('America/Los_Angeles')).toEqual(expected);
  });
});
