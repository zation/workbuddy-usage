import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import { FOCUS_DIM_OPACITY } from '../../shared/constants.ts';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface SeriesEvent {
  componentType?: string;
  seriesType?: string;
  seriesId?: string;
  seriesIndex?: number;
  dataIndex?: number;
}

interface EChartProps {
  option: EChartsOption;
  height?: number;
  ariaLabel?: string;
  /** 指针进出柱段时回调模型业务键；图例、坐标轴与空白类目不触发。 */
  onSeriesHover?: (seriesId: string | null) => void;
  /** 聚焦的柱系列业务键：其余柱系列减淡到 FOCUS_DIM_OPACITY，null 表示全部常态。 */
  focusedSeriesId?: string | null;
}

export function EChart({
  option,
  height = 300,
  ariaLabel,
  onSeriesHover,
  focusedSeriesId = null,
}: EChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const hover = useRef(onSeriesHover);

  useEffect(() => {
    hover.current = onSeriesHover;
  }, [onSeriesHover]);

  useEffect(() => {
    const node = container.current;
    if (!node) {
      return;
    }
    const instance = echarts.init(node);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);

    // 只认柱段：图例与坐标轴的 componentType 不是 series，空白类目不会产生元素事件
    const handleOver = (params: SeriesEvent) => {
      if (params.componentType !== 'series' || params.seriesType !== 'bar') {
        return;
      }
      hover.current?.(params.seriesId ?? null);
      /*
       * 同一次指针事件里 tooltip 先于元素 hover 渲染，且 ECharts 认为「同一类目的
       * 数据没变」就不再重建内容。先藏后显清掉这次缓存，让浮层按新聚焦重绘；
       * 两次派发在同一帧内完成，用户看不到闪烁。
       */
      instance.dispatchAction({ type: 'hideTip' });
      instance.dispatchAction({
        type: 'showTip',
        seriesIndex: params.seriesIndex,
        dataIndex: params.dataIndex,
      });
    };
    const handleOut = (params: SeriesEvent) => {
      if (params.componentType !== 'series' || params.seriesType !== 'bar') {
        return;
      }
      hover.current?.(null);
    };
    const handleGlobalOut = () => hover.current?.(null);

    instance.on('mouseover', handleOver);
    instance.on('mouseout', handleOut);
    instance.on('globalout', handleGlobalOut);

    return () => {
      instance.off('mouseover', handleOver);
      instance.off('mouseout', handleOut);
      instance.off('globalout', handleGlobalOut);
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  /*
   * 系列减淡用定向 merge 实现：只改每个柱系列的 itemStyle.opacity，
   * 不重建 option、不动 series 结构，因此不会打断指针所在的 hover 与浮层。
   */
  useEffect(() => {
    const instance = chart.current;
    if (!instance) {
      return;
    }
    const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
    const patches = series.flatMap((item) => {
      if (!item || item.type !== 'bar' || typeof item.id !== 'string') {
        return [];
      }
      const dim = focusedSeriesId !== null && focusedSeriesId !== item.id;
      return [{ id: item.id, itemStyle: { opacity: dim ? FOCUS_DIM_OPACITY : 1 } }];
    });
    if (patches.length === 0) {
      return;
    }
    instance.setOption({ series: patches });
  }, [option, focusedSeriesId]);

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
