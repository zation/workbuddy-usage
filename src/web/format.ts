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

/** token 数值统一用 K / M / B 缩写，保留 1 位小数；小于 10³ 显示整数。 */
export function formatTokens(value: number): string {
  const magnitude = Math.abs(value);
  for (const { threshold, suffix } of TOKEN_UNITS) {
    if (magnitude >= threshold) {
      return `${(value / threshold).toFixed(1)}${suffix}`;
    }
  }
  return formatInteger(value);
}

/** 上次刷新完成时间，本地时区 HH:mm。 */
export function formatRefreshTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCredit(value: number): string {
  return creditFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
