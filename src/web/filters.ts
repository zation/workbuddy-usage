import { addDays, formatDateKey } from '../shared/dates.ts';
import type { Filters } from '../shared/types.ts';

export type PresetKey = 'today' | 'threeDays' | 'sevenDays' | 'thirtyDays';

/** 快捷区间；四个预设跨度都远小于 MAX_RANGE_DAYS，按钮按此顺序渲染。 */
export const QUICK_PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'threeDays', label: '3 天' },
  { key: 'sevenDays', label: '7 天' },
  { key: 'thirtyDays', label: '30 天' },
];

/** 首屏与「重置」的默认区间。 */
export const DEFAULT_PRESET: PresetKey = 'threeDays';

export function todayKey(): string {
  return formatDateKey(new Date());
}

export function rangeForPreset(preset: PresetKey, today: string): Filters {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'threeDays':
      return { from: addDays(today, -2), to: today };
    case 'sevenDays':
      return { from: addDays(today, -6), to: today };
    case 'thirtyDays':
      return { from: addDays(today, -29), to: today };
  }
}

/** 与四个预设区间做精确比对；日期键定长，字符串相等即区间相等，至多命中一个。 */
export function matchPreset(from: string, to: string, today: string): PresetKey | null {
  for (const preset of QUICK_PRESETS) {
    const range = rangeForPreset(preset.key, today);
    if (range.from === from && range.to === to) {
      return preset.key;
    }
  }
  return null;
}

export function hasActiveFilters(filters: Filters): boolean {
  return Boolean(filters.group || filters.session || filters.model);
}

/** 切换时间区间只替换 from / to，保留已选的分组、对话与模型。 */
export function applyPresetRange(range: Filters, current: Filters): Filters {
  return {
    ...range,
    group: current.group,
    session: current.session,
    model: current.model,
  };
}
