import { BUSINESS_TZ_OFFSET_MS } from '../shared/constants.ts';

const integerFormatter = new Intl.NumberFormat('zh-CN');
const creditFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInteger(value: number): string {
  return integerFormatter.format(Math.round(value));
}

const TOKEN_UNITS = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
] as const;

/**
 * token 数值统一用 K / M / B 缩写，保留 1 位小数；小于 10³ 显示整数。
 * 四舍五入后达到 1000.0 的进位到上一单位，避免出现 `1000.0K` 这类不直观的写法。
 */
export function formatTokens(value: number): string {
  const magnitude = Math.abs(value);
  let index = TOKEN_UNITS.findIndex((unit) => magnitude >= unit.threshold);
  if (index === -1) {
    return formatInteger(value);
  }

  let scaled = Number((value / TOKEN_UNITS[index].threshold).toFixed(1));
  while (Math.abs(scaled) >= 1000 && index > 0) {
    index -= 1;
    scaled = Number((value / TOKEN_UNITS[index].threshold).toFixed(1));
  }
  return `${scaled.toFixed(1)}${TOKEN_UNITS[index].suffix}`;
}

/** 固定业务时区 UTC+8 的时间字段，不读浏览器时区。 */
function businessDate(timestampMs: number): Date {
  return new Date(timestampMs + BUSINESS_TZ_OFFSET_MS);
}

/** 上次刷新完成时间，固定业务时区 HH:mm。 */
export function formatRefreshTime(timestampMs: number): string {
  const date = businessDate(timestampMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function formatCredit(value: number): string {
  return creditFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(timestampMs: number): string {
  const date = businessDate(timestampMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
