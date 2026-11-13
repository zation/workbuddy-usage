import { describe, expect, it } from 'vitest';
import { BUSINESS_TZ_OFFSET_MS } from '../src/shared/constants.ts';
import { addDays } from '../src/shared/dates.ts';
import type { BreakdownRow, BreakdownSegment, TimeseriesRow } from '../src/shared/types.ts';
import {
  buildTimeseriesAxis,
  cacheHitRate,
  segmentValue,
  segmentWidths,
  visibleBreakdownRows,
  visibleModelKeys,
  visibleSegments,
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
  const beijing = (hour: number, minute: number) =>
    Date.UTC(2026, 10, 12, hour, minute) - BUSINESS_TZ_OFFSET_MS;

  it('按固定业务时区输出 HH:mm', () => {
    expect(formatRefreshTime(beijing(9, 5))).toBe('09:05');
    expect(formatRefreshTime(beijing(23, 59))).toBe('23:59');
    expect(formatRefreshTime(beijing(0, 0))).toBe('00:00');
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

function timeseriesRow(date: string): TimeseriesRow {
  return {
    date,
    model: 'model-a',
    modelName: 'Model-A',
    totalTokens: 1,
    inputTokens: 1,
    outputTokens: 0,
    cacheReadTokens: 0,
    credit: 0,
    requestCount: 1,
  };
}

describe('buildTimeseriesAxis', () => {
  it('按筛选区间生成含首尾的连续日期，与 rows 是否有数据无关', () => {
    expect(
      buildTimeseriesAxis('2026-11-10', '2026-11-12', [timeseriesRow('2026-11-12')]),
    ).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('区间无效、缺少端点或没有数据时不给轴', () => {
    const rows = [timeseriesRow('2026-11-12')];
    expect(buildTimeseriesAxis('2026-11-12', '2026-11-10', rows)).toEqual([]);
    expect(buildTimeseriesAxis(undefined, '2026-11-12', rows)).toEqual([]);
    expect(buildTimeseriesAxis('2026-11-10', undefined, rows)).toEqual([]);
    expect(buildTimeseriesAxis('2026-11-10', '2026-11-12', [])).toEqual([]);
  });

  it('跨度上限内最多产出 100 个类目', () => {
    const from = '2026-01-01';
    const axis = buildTimeseriesAxis(from, addDays(from, 99), [timeseriesRow(from)]);
    expect(axis).toHaveLength(100);
    expect(axis[0]).toBe(from);
    expect(axis.at(-1)).toBe(addDays(from, 99));
  });
});

function segment(model: string, totalTokens: number, credit = 0): BreakdownSegment {
  return { model, modelName: model.toUpperCase(), totalTokens, credit };
}

describe('segmentValue', () => {
  it('按当前主指标取值', () => {
    const seg = segment('model-a', 300, 1.5);
    expect(segmentValue(seg, 'token')).toBe(300);
    expect(segmentValue(seg, 'credit')).toBe(1.5);
  });
});

describe('visibleSegments', () => {
  const rowWithModels = row({
    key: '/work/alpha',
    totalTokens: 400,
    credit: 4,
    models: [
      segment('model-a', 300, 1.5),
      segment('model-b', 100, 2.5),
      segment('model-zero', 0, 0),
      segment('model-hidden', 50, 0),
      segment('model-negative', -10, -1),
    ],
  });

  it('只保留主指标大于 0 且可见的段，按数额降序', () => {
    const visible = visibleSegments(rowWithModels, 'token', new Set(['model-a', 'model-b', 'model-zero', 'model-negative']));
    expect(visible.map((seg) => seg.model)).toEqual(['model-a', 'model-b']);
  });

  it('积分 tab 按 credit 过滤与排序', () => {
    const visible = visibleSegments(
      rowWithModels,
      'credit',
      new Set(['model-a', 'model-b', 'model-zero', 'model-hidden', 'model-negative']),
    );
    expect(visible.map((seg) => [seg.model, seg.credit])).toEqual([
      ['model-b', 2.5],
      ['model-a', 1.5],
    ]);
  });

  it('同值按模型业务键升序，且不修改原数组', () => {
    const original = [segment('model-c', 50), segment('model-a', 50), segment('model-b', 100)];
    const sorted = visibleSegments(
      row({ key: 'g', totalTokens: 200, models: original }),
      'token',
      new Set(['model-a', 'model-b', 'model-c']),
    );
    expect(sorted.map((seg) => seg.model)).toEqual(['model-b', 'model-a', 'model-c']);
    expect(original.map((seg) => seg.model)).toEqual(['model-c', 'model-a', 'model-b']);
  });

  it('没有分段时返回空数组', () => {
    expect(visibleSegments(row({ key: 'g', totalTokens: 10 }), 'token', new Set(['model-a']))).toEqual(
      [],
    );
  });
});

describe('segmentWidths', () => {
  it('各段宽度之和等于原单色条宽', () => {
    const segments = [segment('model-a', 300), segment('model-b', 100)];
    const widths = segmentWidths(0.5, 400, segments, 'token');
    expect(widths).toEqual([37.5, 12.5]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(50, 10);
  });

  it('单段占满整条宽度', () => {
    expect(segmentWidths(0.25, 100, [segment('model-a', 100)], 'token')).toEqual([25]);
  });

  it('行值为 0、没有段或占比为 0 时不画色段', () => {
    expect(segmentWidths(0.5, 0, [segment('model-a', 10)], 'token')).toEqual([]);
    expect(segmentWidths(0.5, 100, [], 'token')).toEqual([]);
    expect(segmentWidths(0, 100, [segment('model-a', 100)], 'token')).toEqual([]);
  });

  it('三段均分时用最后一段补齐浮点误差', () => {
    const segments = [segment('a', 1), segment('b', 1), segment('c', 1)];
    const widths = segmentWidths(1, 3, segments, 'token');
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 10);
  });

  it('占比超过 100% 时限幅为 100，负值不出现', () => {
    const segments = [segment('a', 300), segment('b', 100)];
    const widths = segmentWidths(2, 400, segments, 'token');
    expect(widths).toEqual([75, 25]);
    expect(widths.every((width) => width >= 0 && width <= 100)).toBe(true);
  });
});
