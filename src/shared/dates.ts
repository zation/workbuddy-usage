const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 按运行进程的本地时区把毫秒时间戳折算为 YYYY-MM-DD。 */
export function toDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地日期零点，用于日期加减而不受夏令时影响。 */
function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function addDays(key: string, delta: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + delta);
  return formatDateKey(date);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const parsed = parseDateKey(value);
  return formatDateKey(parsed) === value;
}

/** 服务层补齐时序日期区间时使用，包含首尾。 */
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
