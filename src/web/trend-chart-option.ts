import type { EChartsOption } from 'echarts';
import type { PriceRatioRow } from '../shared/types.ts';
import type { TrendChartData } from './display.ts';
import { formatCredit, formatInteger, formatTokens } from './format.ts';
import { modelColor } from './model-colors.ts';

export const PRICE_RATIO_SERIES_ID = 'price-ratio';

const PRICE_RATIO_COLOR = '#B45309';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 提示内容按 HTML 渲染，展示名由本地面板数据提供，做最小转义。 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

function axisValue(value: number, metric: 'tokens' | 'credit'): string {
  return metric === 'credit' ? formatInteger(value) : formatTokens(value);
}

interface TooltipParam {
  axisValue?: string | number;
  seriesId?: string;
  seriesName?: string;
  value?: unknown;
  marker?: string;
}

/** 图表配置由已聚合数据生成：柱口径不变，价格比率折线只叠加在 Token 图上。 */
export function buildTrendChartOption(
  data: TrendChartData | null,
  metric: 'tokens' | 'credit',
  ratios?: PriceRatioRow[],
): EChartsOption {
  const formatValue = (value: number): string =>
    metric === 'tokens' ? formatTokens(value) : formatCredit(value);
  const days = data?.days ?? [];
  const rows = data?.rows ?? [];
  const models = new Map<string, string>();
  for (const row of rows) {
    if (!models.has(row.model)) {
      models.set(row.model, row.modelName);
    }
  }
  const modelKeys = [...models.keys()].sort((left, right) =>
    (models.get(left) ?? left).localeCompare(models.get(right) ?? right, 'zh-CN'),
  );

  const showRatio = metric === 'tokens' && (ratios?.length ?? 0) > 0;
  const ratioMap = new Map<string, number | null>();
  for (const row of ratios ?? []) {
    ratioMap.set(row.date, row.ratio);
  }

  const barSeries = modelKeys.map((modelKey) => {
    const values = new Map<string, number>();
    for (const row of rows) {
      if (row.model === modelKey) {
        values.set(row.date, metric === 'tokens' ? row.totalTokens : row.credit);
      }
    }
    return {
      id: modelKey,
      name: models.get(modelKey) ?? modelKey,
      type: 'bar' as const,
      stack: 'models',
      yAxisIndex: 0,
      barMaxWidth: 28,
      itemStyle: {
        color: modelColor(modelKey),
        borderColor: '#ffffff',
        borderWidth: 1,
      },
      emphasis: { focus: 'series' as const },
      data: days.map((day) => values.get(day) ?? 0),
    };
  });

  const ratioSeries = showRatio
    ? [
        {
          id: PRICE_RATIO_SERIES_ID,
          name: '价格比率',
          type: 'line' as const,
          yAxisIndex: 1,
          connectNulls: false,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: PRICE_RATIO_COLOR, width: 2 },
          itemStyle: { color: PRICE_RATIO_COLOR },
          data: days.map((day) => ratioMap.get(day) ?? null),
          z: 5,
        },
      ]
    : [];

  const valueAxis = {
    type: 'value' as const,
    splitLine: { lineStyle: { color: '#eef0f3' } },
    axisLabel: {
      color: '#7b8494',
      fontSize: 11,
      formatter: (value: string | number) => axisValue(Number(value), metric),
    },
  };
  const ratioAxis = {
    type: 'value' as const,
    name: '×',
    nameTextStyle: { color: '#7b8494', fontSize: 11 },
    min: 0,
    splitLine: { show: false },
    axisLabel: {
      color: '#7b8494',
      fontSize: 11,
      formatter: (value: string | number) => `${Number(value)}×`,
    },
  };

  return {
    animationDuration: 240,
    grid: { left: 12, right: 16, top: 16, bottom: 44, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        // 日期取过滤前的 params：全 0 日过滤后没有项可取 axisValue。
        const raw = (Array.isArray(params) ? params : [params]) as unknown as TooltipParam[];
        const axis = escapeHtml(String(raw[0]?.axisValue ?? ''));
        const bars = raw.filter((item) => item.seriesId !== PRICE_RATIO_SERIES_ID);
        const ratioParam = raw.find((item) => item.seriesId === PRICE_RATIO_SERIES_ID);
        const list = bars
          .filter((item) => Number(item.value) > 0)
          .sort((left, right) => Number(right.value) - Number(left.value));
        const lines = list.map(
          (item) =>
            `${item.marker ?? ''}${escapeHtml(item.seriesName ?? '')}：${formatValue(Number(item.value))}`,
        );
        if (ratioParam && ratioParam.value !== null && ratioParam.value !== undefined) {
          lines.push(
            `${ratioParam.marker ?? ''}DeepSeek 费用比率：${Number(ratioParam.value).toFixed(2)}×`,
          );
        }
        if (lines.length === 0) {
          return `${axis}<br/>无数据`;
        }
        return [axis, ...lines].join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      type: 'scroll',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: '#4b5563', fontSize: 11 },
      data: showRatio ? modelKeys.map((key) => models.get(key) ?? key) : undefined,
    },
    xAxis: {
      type: 'category',
      data: days,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e6e8eb' } },
      axisLabel: {
        color: '#7b8494',
        fontSize: 11,
        formatter: (value: string | number) => String(value).slice(5),
      },
    },
    yAxis: showRatio ? [valueAxis, ratioAxis] : valueAxis,
    series: [...barSeries, ...ratioSeries],
  };
}
