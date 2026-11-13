import { useMemo } from 'react';
import type { PriceRatioRow } from '../../shared/types.ts';
import type { TrendChartData } from '../display.ts';
import { buildTrendChartOption } from '../trend-chart-option.ts';
import { EChart } from './EChart.tsx';

interface TrendChartProps {
  title: string;
  metric: 'tokens' | 'credit';
  data: TrendChartData | null;
  ratios?: PriceRatioRow[];
  loading: boolean;
  error: string | null;
}

export function TrendChart({
  title,
  metric,
  data,
  ratios,
  loading,
  error,
}: TrendChartProps) {
  const option = useMemo(
    () => buildTrendChartOption(data, metric, ratios),
    [data, metric, ratios],
  );

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
