import { describe, expect, it } from 'vitest';
import type { BreakdownRow } from '../src/shared/types.ts';
import {
  cacheHitRate,
  visibleBreakdownRows,
  visibleModelKeys,
} from '../src/web/display.ts';
import {
  formatCredit,
  formatInteger,
  formatPercent,
  formatRefreshTime,
  formatTokens,
} from '../src/web/format.ts';

function row(overrides: Partial<BreakdownRow> & { key: string }): BreakdownRow {
  return {
    name: overrides.key,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    credit: 0,
    requestCount: 0,
    sessionCount: 0,
    tokenShare: 0,
    creditShare: 0,
    ...overrides,
  };
}

describe('formatTokens', () => {
  it('小于 10³ 显示整数千分位', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(999)).toBe('999');
  });

  it('按 10³ / 10⁶ / 10⁹ 切换单位并保留 1 位小数', () => {
    expect(formatTokens(1_000)).toBe('1.0K');
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(999_999)).toBe('1000.0K');
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_250_000)).toBe('1.3M');
    expect(formatTokens(1_000_000_000)).toBe('1.0B');
    expect(formatTokens(2_500_000_000)).toBe('2.5B');
  });

  it('其它格式函数行为不变', () => {
    expect(formatInteger(1_234)).toBe('1,234');
    expect(formatInteger(0)).toBe('0');
    expect(formatCredit(3.75)).toBe('3.75');
    expect(formatCredit(0)).toBe('0.00');
    expect(formatPercent(0.6)).toBe('60.0%');
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('formatRefreshTime', () => {
  it('按本地时区输出 HH:mm', () => {
    expect(formatRefreshTime(new Date(2026, 10, 12, 9, 5).getTime())).toBe('09:05');
    expect(formatRefreshTime(new Date(2026, 10, 12, 23, 59).getTime())).toBe('23:59');
    expect(formatRefreshTime(new Date(2026, 10, 12, 0, 0).getTime())).toBe('00:00');
  });
});

describe('visibleModelKeys', () => {
  const rows = [
    row({ key: 'token-only', totalTokens: 100, credit: 0 }),
    row({ key: 'credit-only', totalTokens: 0, credit: 2.5 }),
    row({ key: 'both', totalTokens: 300, credit: 1 }),
    row({ key: 'neither', totalTokens: 0, credit: 0 }),
  ];

  it('Token tab 过滤 totalTokens 为 0 的模型', () => {
    expect([...visibleModelKeys(rows, 'token')]).toEqual(['token-only', 'both']);
  });

  it('积分 tab 过滤 credit 为 0 的模型', () => {
    expect([...visibleModelKeys(rows, 'credit')]).toEqual(['credit-only', 'both']);
  });

  it('两个 tab 各自判断，仅在当前 tab 为 0 的模型只在该 tab 隐藏', () => {
    const tokenVisible = visibleModelKeys(rows, 'token');
    const creditVisible = visibleModelKeys(rows, 'credit');
    expect(tokenVisible.has('credit-only')).toBe(false);
    expect(creditVisible.has('credit-only')).toBe(true);
    expect(tokenVisible.has('token-only')).toBe(true);
    expect(creditVisible.has('token-only')).toBe(false);
  });
});

describe('visibleBreakdownRows', () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    row({ key: `m${index}`, totalTokens: 1000 - index * 10 }),
  );

  it('超过上限时只截取前 limit 行', () => {
    const visible = visibleBreakdownRows(rows, 8);
    expect(visible).toHaveLength(8);
    expect(visible.map((item) => item.key)).toEqual(rows.slice(0, 8).map((item) => item.key));
  });

  it('不足上限时按实际行数返回，全量计数不受截断影响', () => {
    const few = rows.slice(0, 3);
    expect(visibleBreakdownRows(few, 8)).toHaveLength(3);
    expect(few).toHaveLength(3);
    expect(rows).toHaveLength(10);
  });

  it('不修改入参且上限为 0 时返回空数组', () => {
    const original = [...rows];
    expect(visibleBreakdownRows(rows, 0)).toEqual([]);
    expect(rows).toEqual(original);
  });
});

describe('cacheHitRate', () => {
  it('按缓存命中除以输入计算', () => {
    expect(cacheHitRate(900, 10)).toBeCloseTo(10 / 900, 10);
    expect(cacheHitRate(100, 100)).toBe(1);
    expect(cacheHitRate(100, 0)).toBe(0);
  });

  it('分母为 0 时返回 null', () => {
    expect(cacheHitRate(0, 0)).toBeNull();
    expect(cacheHitRate(0, 50)).toBeNull();
  });
});
