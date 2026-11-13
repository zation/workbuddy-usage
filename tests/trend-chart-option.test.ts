import { describe, expect, it } from 'vitest';
import type { PriceRatioRow, TimeseriesRow } from '../src/shared/types.ts';
import type { TrendChartData } from '../src/web/display.ts';
import {
  PRICE_RATIO_SERIES_ID,
  buildTrendChartOption,
} from '../src/web/trend-chart-option.ts';

function row(date: string, total: number, model = 'deepseek-v4.1-flash'): TimeseriesRow {
  return {
    date,
    model,
    modelName: 'DeepSeek-V4.1-Flash',
    totalTokens: total,
    inputTokens: total,
    outputTokens: 0,
    cacheReadTokens: 0,
    credit: 10,
    requestCount: 1,
  };
}

const data: TrendChartData = {
  days: ['2026-11-11', '2026-11-12', '2026-11-13'],
  rows: [row('2026-11-11', 1000), row('2026-11-12', 2000)],
};

const ratios: PriceRatioRow[] = [
  { date: '2026-11-11', ratio: 4.16, wbCost: 1, officialCost: 0.24 },
  { date: '2026-11-12', ratio: null, wbCost: 1, officialCost: 0 },
];

function parts(option: ReturnType<typeof buildTrendChartOption>) {
  return {
    series: option.series as unknown as Array<Record<string, unknown>>,
    yAxis: option.yAxis as unknown as Array<Record<string, unknown>> | Record<string, unknown>,
    legend: option.legend as unknown as { data?: string[] },
    tooltip: option.tooltip as unknown as { formatter: (params: unknown) => string },
  };
}

describe('趋势图价格比率折线', () => {
  it('无 ratios 时保持单 Y 轴与纯柱状配置', () => {
    const { series, yAxis } = parts(buildTrendChartOption(data, 'tokens'));
    expect(Array.isArray(yAxis)).toBe(false);
    expect(series.every((item) => item.type === 'bar')).toBe(true);
    expect(series.find((item) => item.id === PRICE_RATIO_SERIES_ID)).toBeUndefined();
  });

  it('有 ratios 时启用第二 Y 轴与单条折线，null 断线且不进图例', () => {
    const { series, yAxis, legend } = parts(buildTrendChartOption(data, 'tokens', ratios));
    expect(Array.isArray(yAxis)).toBe(true);
    expect((yAxis as Array<Record<string, unknown>>)[1]?.name).toBe('×');
    const line = series.find((item) => item.id === PRICE_RATIO_SERIES_ID);
    expect(line?.type).toBe('line');
    expect(line?.yAxisIndex).toBe(1);
    expect(line?.connectNulls).toBe(false);
    expect(line?.data).toEqual([4.16, null, null]);
    expect(series.filter((item) => item.type === 'line')).toHaveLength(1);
    expect(legend.data).not.toContain('价格比率');
    expect(series.filter((item) => item.type === 'bar').every((item) => item.yAxisIndex === 0)).toBe(true);
  });

  it('积分图与空 ratios 都不显示折线', () => {
    expect(parts(buildTrendChartOption(data, 'credit', ratios)).series).toHaveLength(1);
    expect(parts(buildTrendChartOption(data, 'tokens', [])).series).toHaveLength(1);
  });

  it('tooltip 按 seriesId 分流：柱子用原格式与降序，折线单独一行带 ×', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', ratios));
    const html = tooltip.formatter([
      { axisValue: '2026-11-11', seriesId: 'deepseek-v4.1-flash', seriesName: 'DeepSeek', value: 1000, marker: 'A' },
      { axisValue: '2026-11-11', seriesId: 'zero-model', seriesName: 'Zero', value: 0, marker: 'B' },
      { axisValue: '2026-11-11', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: 4.16, marker: 'C' },
    ]);
    expect(html).toContain('1.0K');
    expect(html).toContain('4.16×');
    expect(html).not.toContain('Zero');
    expect(html.indexOf('1.0K')).toBeLessThan(html.indexOf('4.16×'));
  });

  it('折线值为 null 时 tooltip 不追加比率行', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', ratios));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: null, marker: 'C' },
    ]);
    expect(html).toBe('2026-11-12<br/>无数据');
  });
});
