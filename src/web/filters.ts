import { addDays, formatDateKey } from '../shared/dates.ts';
import type { Filters } from '../shared/types.ts';

export type PresetKey = 'today' | 'sevenDays' | 'thirtyDays' | 'month' | 'all' | 'custom';

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'sevenDays', label: '近 7 天' },
  { key: 'thirtyDays', label: '近 30 天' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '全部' },
  { key: 'custom', label: '自定义' },
];

export interface CustomRange {
  from: string;
  to: string;
}

export function todayKey(): string {
  return formatDateKey(new Date());
}

export function rangeForPreset(
  preset: PresetKey,
  today: string,
  custom: CustomRange,
): Filters {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'sevenDays':
      return { from: addDays(today, -6), to: today };
    case 'thirtyDays':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'all':
      return {};
    case 'custom':
      return { from: custom.from || undefined, to: custom.to || undefined };
  }
}

export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(filters.group || filters.session || filters.model);
}
