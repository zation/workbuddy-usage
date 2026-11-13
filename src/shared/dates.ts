import { BUSINESS_TZ_OFFSET_MS } from './constants.ts';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 绝对时间戳按固定业务时区 UTC+8 折算为 YYYY-MM-DD，不读运行进程时区。 */
export function toDateKey(timestampMs: number): string {
  const date = new Date(timestampMs + BUSINESS_TZ_OFFSET_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 纯 UTC 日期键格式化，只服务日期键算术，不用于把当前时间折算成业务日期。 */
export function formatDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 用 UTC 零点构造日期键，避免本地时区与夏令时影响。 */
function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

export function addDays(key: string, delta: number): string {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + delta);
  return formatDateKey(date);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const parsed = parseDateKey(value);
  return formatDateKey(parsed) === value;
}

/**
 * 日期区间跨度（含首尾天数）。用 UTC 解析日期键，结果不受运行进程时区与夏令时影响；
 * 与 MAX_RANGE_DAYS 比较即可判断区间是否超限。
 */
export function daySpan(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

/** 补齐连续日期区间时使用，包含首尾。 */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 3700; guard += 1) {
    days.push(cursor);
    if (cursor >= to) {
      break;
    }
    cursor = addDays(cursor, 1);
  }
  return days;
}
