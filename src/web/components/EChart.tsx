import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';
import type { EChartsOption } from 'echarts';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface EChartProps {
  option: EChartsOption;
  height?: number;
  ariaLabel?: string;
}

export function EChart({ option, height = 300, ariaLabel }: EChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    const instance = echarts.init(node);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={container}
      className="chart"
      style={{ height }}
      role="img"
      aria-label={ariaLabel ?? '趋势图'}
    />
  );
}
