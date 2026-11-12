import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { TimeseriesResponse } from '../../shared/types.ts';
import { formatCredit, formatInteger } from '../format.ts';
import { MODEL_COLORS } from '../palette.ts';
import { EChart } from './EChart.tsx';

const PALETTE = MODEL_COLORS;

interface TrendChartProps {
  title: string;
  metric: 'tokens' | 'credit';
  data: TimeseriesResponse | null;
  loading: boolean;
  error: string | null;
}

function axisValue(value: number, metric: 'tokens' | 'credit'): string {
  if (metric === 'credit') {
    return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(1)}万`;
  }
  return String(Math.round(value));
}

export function TrendChart({ title, metric, data, loading, error }: TrendChartProps) {
  const option = useMemo<EChartsOption>(() => {
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

    const series = modelKeys.map((modelKey, index) => {
      const values = new Map<string, number>();
      for (const row of rows) {
        if (row.model === modelKey) {
          values.set(row.date, metric === 'tokens' ? row.totalTokens : row.credit);
        }
      }
      return {
        name: models.get(modelKey) ?? modelKey,
        type: 'bar' as const,
        stack: 'models',
        barMaxWidth: 28,
        itemStyle: { color: PALETTE[index % PALETTE.length] },
        emphasis: { focus: 'series' as const },
        data: days.map((day) => values.get(day) ?? 0),
      };
    });

    return {
      animationDuration: 240,
      color: PALETTE,
      grid: { left: 12, right: 16, top: 16, bottom: 44, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value) =>
          metric === 'tokens' ? formatInteger(Number(value)) : formatCredit(Number(value)),
      },
      legend: {
        bottom: 0,
        type: 'scroll',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#4b5563', fontSize: 11 },
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
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#eef0f3' } },
        axisLabel: {
          color: '#7b8494',
          fontSize: 11,
          formatter: (value: string | number) => axisValue(Number(value), metric),
        },
      },
      series,
    };
  }, [data, metric]);

  return (
    <div className="panel trend-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="panel-meta">堆叠按模型着色 · 粒度按天</span>
      </div>
      {error ? <p className="panel-error">{error}</p> : null}
      {loading && !data ? <div className="skeleton-line chart-skeleton" /> : null}
      {!loading && !error && (data?.rows.length ?? 0) === 0 ? (
        <p className="panel-empty">当前筛选下没有数据</p>
      ) : null}
      {(data?.rows.length ?? 0) > 0 ? (
        <EChart
          option={option}
          height={300}
          ariaLabel={`${title}，按天按模型堆叠`}
        />
      ) : null}
    </div>
  );
}
