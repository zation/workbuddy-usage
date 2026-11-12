const integerFormatter = new Intl.NumberFormat('zh-CN');
const creditFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInteger(value: number): string {
  return integerFormatter.format(Math.round(value));
}

export function formatCredit(value: number): string {
  return creditFormatter.format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
