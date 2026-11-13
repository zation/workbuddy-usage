import { enumerateDays } from '../shared/dates.ts';
import type { BreakdownRow, TimeseriesRow } from '../shared/types.ts';

/** 面板当前激活的模块 tab，决定 0 值隐藏使用哪个主指标。 */
export type ModuleTab = 'token' | 'credit';

/** 趋势图输入：连续日期轴由面板按筛选区间生成，rows 只含有数据的按天按模型行。 */
export interface TrendChartData {
  days: string[];
  rows: TimeseriesRow[];
}

/**
 * R10：按 from / to 生成含首尾的连续日期轴，缺失日期由调用方补 0。
 * 轴是展示派生，用原始 rows 计算，不受 0 值隐藏影响；区间无效或没有数据时不给轴。
 */
export function buildTimeseriesAxis(
  from: string | undefined,
  to: string | undefined,
  rows: TimeseriesRow[],
): string[] {
  if (!from || !to || from > to || rows.length === 0) {
    return [];
  }
  return enumerateDays(from, to);
}

/**
 * R7：按当前 tab 的主指标过滤模型，Token 看 totalTokens、积分看 credit。
 * 只隐藏恰好为 0 的模型，负值视为可见；返回的集合供趋势图、按模型拆分与模型下拉共用。
 */
export function visibleModelKeys(rows: BreakdownRow[], tab: ModuleTab): Set<string> {
  const visible = new Set<string>();
  for (const row of rows) {
    const metric = tab === 'token' ? row.totalTokens : row.credit;
    if (metric !== 0) {
      visible.add(row.key);
    }
  }
  return visible;
}

/** R3：拆分列表只渲染前 limit 行，占比与项数仍由调用方按全量结果计算。 */
export function visibleBreakdownRows(rows: BreakdownRow[], limit: number): BreakdownRow[] {
  return rows.slice(0, Math.max(0, limit));
}

/** R6：缓存命中比率以 inputTokens 为分母，分母为 0 时无定义。 */
export function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number | null {
  return inputTokens > 0 ? cacheReadTokens / inputTokens : null;
}
