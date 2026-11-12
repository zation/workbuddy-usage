import { describe, expect, it } from 'vitest';
import type { BreakdownRow } from '../src/shared/types.ts';
import {
  cacheHitRate,
  modelColorIndex,
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
    expect(formatTokens(999_000)).toBe('999.0K');
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(1_250_000)).toBe('1.3M');
    expect(formatTokens(1_000_000_000)).toBe('1.0B');
    expect(formatTokens(2_500_000_000)).toBe('2.5B');
  });

  it('四舍五入后达到 1000.0 时进位到上一单位', () => {
    expect(formatTokens(999_999)).toBe('1.0M');
    expect(formatTokens(999_990)).toBe('1.0M');
    expect(formatTokens(999_999_999)).toBe('1.0B');
    expect(formatTokens(-999_999)).toBe('-1.0M');
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

  it('只隐藏恰好为 0 的模型，负值视为可见', () => {
    const signed = [
      row({ key: 'positive', totalTokens: 10, credit: 1 }),
      row({ key: 'zero', totalTokens: 0, credit: 0 }),
      row({ key: 'negative', totalTokens: -5, credit: -2 }),
    ];
    expect([...visibleModelKeys(signed, 'token')]).toEqual(['positive', 'negative']);
    expect([...visibleModelKeys(signed, 'credit')]).toEqual(['positive', 'negative']);
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

describe('modelColorIndex', () => {
  const rows = [
    row({ key: 'm-c', name: 'Gamma' }),
    row({ key: 'm-a', name: 'Alpha' }),
    row({ key: 'm-b', name: 'Beta' }),
  ];

  it('按展示名排序分配色位，与入参顺序无关', () => {
    const expected = { 'm-a': 0, 'm-b': 1, 'm-c': 2 };
    expect(modelColorIndex(rows)).toEqual(expected);
    expect(modelColorIndex([...rows].reverse())).toEqual(expected);
  });

  it('展示名相同时按业务键兜底，重复业务键只占一个色位', () => {
    const duplicated = [
      row({ key: 'z-key', name: 'Same' }),
      row({ key: 'a-key', name: 'Same' }),
      row({ key: 'a-key', name: 'Same' }),
      row({ key: 'b-key', name: 'Beta' }),
    ];
    expect(modelColorIndex(duplicated)).toEqual({ 'b-key': 0, 'a-key': 1, 'z-key': 2 });
  });

  it('两个 tab 的可见子集共享同一索引', () => {
    const index = modelColorIndex(rows);
    const tokenTab = rows.filter((item) => item.key !== 'm-b');
    const creditTab = rows.filter((item) => item.key !== 'm-c');
    expect(tokenTab.map((item) => index[item.key])).toEqual([2, 0]);
    expect(creditTab.map((item) => index[item.key])).toEqual([0, 1]);
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
