import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { TrendChartData } from '../display.ts';
import { formatCredit, formatInteger, formatTokens } from '../format.ts';
import { modelColor } from '../model-colors.ts';
import { EChart } from './EChart.tsx';

interface TrendChartProps {
  title: string;
  metric: 'tokens' | 'credit';
  data: TrendChartData | null;
  loading: boolean;
  error: string | null;
}

function axisValue(value: number, metric: 'tokens' | 'credit'): string {
  return metric === 'credit' ? formatInteger(value) : formatTokens(value);
}

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

interface TooltipParam {
  axisValue?: string | number;
  seriesName?: string;
  value?: unknown;
  marker?: string;
}

export function TrendChart({ title, metric, data, loading, error }: TrendChartProps) {
  const option = useMemo<EChartsOption>(() => {
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

    const series = modelKeys.map((modelKey) => {
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

    return {
      animationDuration: 240,
      grid: { left: 12, right: 16, top: 16, bottom: 44, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (value) => formatValue(Number(value)),
        formatter: (params) => {
          // 日期取过滤前的 params：全 0 日过滤后没有项可取 axisValue。
          const raw = (Array.isArray(params) ? params : [params]) as unknown as TooltipParam[];
          const axis = escapeHtml(String(raw[0]?.axisValue ?? ''));
          const list = raw
            .filter((item) => Number(item.value) > 0)
            .sort((left, right) => Number(right.value) - Number(left.value));
          if (list.length === 0) {
            return `${axis}<br/>无数据`;
          }
          const lines = list.map(
            (item) =>
              `${item.marker ?? ''}${escapeHtml(item.seriesName ?? '')}：${formatValue(Number(item.value))}`,
          );
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
