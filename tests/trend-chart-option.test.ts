import { describe, expect, it } from 'vitest';
import { FOCUS_DIM_OPACITY } from '../src/shared/constants.ts';
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
    tooltip: option.tooltip as unknown as {
      formatter: (params: unknown) => string;
      valueFormatter?: (value: unknown) => string;
    },
  };
}

describe('趋势图价格比率折线', () => {
  it('无 ratios 时保持单 Y 轴与纯柱状配置', () => {
    const { series, yAxis, tooltip } = parts(buildTrendChartOption(data, 'tokens'));
    expect(Array.isArray(yAxis)).toBe(false);
    expect(series.every((item) => item.type === 'bar')).toBe(true);
    expect(series.find((item) => item.id === PRICE_RATIO_SERIES_ID)).toBeUndefined();
    expect(tooltip.valueFormatter).toBeUndefined();
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
    expect(html).toContain('DeepSeek 费用比率：4.16×');
    expect(html).not.toContain('Zero');
    expect(html.indexOf('1.0K')).toBeLessThan(html.indexOf('DeepSeek 费用比率：4.16×'));
  });

  it('柱子数值格式由 formatter 输出，移除 valueFormatter 后仍保持', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens'));
    const html = tooltip.formatter([
      { axisValue: '2026-11-11', seriesId: 'deepseek-v4.1-flash', seriesName: 'DeepSeek', value: 1_000_000, marker: 'A' },
    ]);
    expect(html).toContain('1.0M');
    expect(tooltip.valueFormatter).toBeUndefined();

    const credit = parts(buildTrendChartOption(data, 'credit'));
    const creditHtml = credit.tooltip.formatter([
      { axisValue: '2026-11-11', seriesId: 'deepseek-v4.1-flash', seriesName: 'DeepSeek', value: 12.5, marker: 'A' },
    ]);
    expect(creditHtml).toContain('12.50');
  });

  it('折线值为 null 时 tooltip 不追加比率行', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', ratios));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: null, marker: 'C' },
    ]);
    expect(html).toBe(
      '<span class="trend-tip-date">2026-11-12</span><br/><span class="trend-tip-empty">无数据</span>',
    );
  });
});


describe('hover 聚焦的图表配置', () => {
  it('柱系列不带原生 emphasis / blur 减淡，强度只由唯一常量控制', () => {
    expect(FOCUS_DIM_OPACITY).toBe(0.4);
    const { series } = parts(buildTrendChartOption(data, 'tokens', ratios, () => 'hy4'));
    const bars = series.filter((item) => item.type === 'bar');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      // 系列减淡走显式 opacity（EChart 定向 merge），原生状态不再参与，避免叠加
      expect(bar.emphasis).toEqual({ disabled: true });
      expect(bar.blur).toBeUndefined();
    }
  });

  it('tooltip 模型行按业务键减淡，日期行常态，聚焦行 1.0', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', undefined, () => 'hy4'));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: 'glm-5.2', seriesName: 'GLM-5.2', value: 300, marker: 'B' },
    ]);
    const rows = html.split('<br/>');
    expect(rows[0]).toBe('<span class="trend-tip-date">2026-11-12</span>');
    expect(rows[1]).toBe('<span class="trend-tip-row" style="opacity:1">AHy4：1.2K</span>');
    expect(rows[2]).toBe(
      `<span class="trend-tip-row" style="opacity:${FOCUS_DIM_OPACITY}">BGLM-5.2：300</span>`,
    );
  });

  it('无聚焦时所有模型行都是 1.0', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens'));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: 'glm-5.2', seriesName: 'GLM-5.2', value: 300, marker: 'B' },
    ]);
    expect(html).not.toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(html.match(/opacity:1/gu)).toHaveLength(2);
  });

  it('「无数据」分支不带减淡样式，日期照常保留', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', undefined, () => 'hy4'));
    const html = tooltip.formatter([{ axisValue: '2026-11-11' }]);
    expect(html).toBe(
      '<span class="trend-tip-date">2026-11-11</span><br/><span class="trend-tip-empty">无数据</span>',
    );
    expect(html).not.toContain('opacity');
  });

  it('hover 柱段时比率行随其它非聚焦行减淡，柱子仍按原规则过滤降序', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', ratios, () => 'hy4'));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'deepseek-v4.1-flash', seriesName: 'DeepSeek', value: 4000, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: 'zero-model', seriesName: 'Zero', value: 0, marker: 'B' },
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'C' },
      { axisValue: '2026-11-12', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: 1.76, marker: 'D' },
    ]);
    const rows = html.split('<br/>');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(rows[1]).toContain('DeepSeek');
    expect(rows[2]).toContain('opacity:1');
    expect(rows[2]).toContain('Hy4');
    expect(html).not.toContain('Zero');
    expect(rows[3]).toContain('is-ratio');
    expect(rows[3]).toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(rows[3]).toContain('1.76×');
  });

  it('hover 折线时只有比率行常态，所有模型行减淡', () => {
    const { tooltip } = parts(
      buildTrendChartOption(data, 'tokens', ratios, () => PRICE_RATIO_SERIES_ID),
    );
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'deepseek-v4.1-flash', seriesName: 'DeepSeek', value: 4000, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'C' },
      { axisValue: '2026-11-12', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: 1.76, marker: 'D' },
    ]);
    const rows = html.split('<br/>');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(rows[2]).toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(rows[3]).toContain('is-ratio');
    expect(rows[3]).toContain('opacity:1');
    expect(rows[3]).not.toContain(`opacity:${FOCUS_DIM_OPACITY}`);
  });

  it('无聚焦时比率行与模型行都是 1.0', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', ratios));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: PRICE_RATIO_SERIES_ID, seriesName: '价格比率', value: 1.76, marker: 'D' },
    ]);
    expect(html).not.toContain(`opacity:${FOCUS_DIM_OPACITY}`);
    expect(html.match(/opacity:1/gu)).toHaveLength(2);
  });

  it('折线系列可在线段上触发 hover，且不带原生 emphasis', () => {
    const { series } = parts(buildTrendChartOption(data, 'tokens', ratios));
    const line = series.find((item) => item.id === PRICE_RATIO_SERIES_ID);
    expect(line?.triggerEvent).toBe('line');
    expect(line?.emphasis).toEqual({ disabled: true });
    expect((line?.lineStyle as { opacity?: number } | undefined)?.opacity).toBe(1);
  });

  it('展示名相同但业务键不同时按业务键判定', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens', undefined, () => 'hy4'));
    const html = tooltip.formatter([
      { axisValue: '2026-11-12', seriesId: 'hy4', seriesName: 'Hy4', value: 1200, marker: 'A' },
      { axisValue: '2026-11-12', seriesId: 'hy4-free', seriesName: 'Hy4', value: 300, marker: 'B' },
    ]);
    const rows = html.split('<br/>');
    expect(rows[1]).toContain('opacity:1');
    expect(rows[2]).toContain(`opacity:${FOCUS_DIM_OPACITY}`);
  });

  it('tooltip 带稳定类名，供浮层定位使用', () => {
    const { tooltip } = parts(buildTrendChartOption(data, 'tokens'));
    expect((tooltip as unknown as { className?: string }).className).toBe('trend-tooltip');
  });
});
