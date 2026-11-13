import { describe, expect, it } from 'vitest';
import type { Filters } from '../src/shared/types.ts';
import {
  DEFAULT_PRESET,
  QUICK_PRESETS,
  applyPresetRange,
  matchPreset,
  rangeForPreset,
} from '../src/web/filters.ts';

const today = '2026-11-12';

function currentFilters(): Filters {
  return {
    from: '2026-11-12',
    to: '2026-11-12',
    group: '/work/alpha',
    session: 'sess-1',
    model: 'model-a',
  };
}

describe('时间预设与维度筛选联动', () => {
  it('切换时间预设只替换日期，保留分组、对话与模型', () => {
    const next = applyPresetRange(rangeForPreset('sevenDays', today), currentFilters());
    expect(next).toEqual({
      from: '2026-11-06',
      to: '2026-11-12',
      group: '/work/alpha',
      session: 'sess-1',
      model: 'model-a',
    });
  });

  it('四个预设都含首尾按天数回推', () => {
    expect(rangeForPreset('today', today)).toEqual({ from: today, to: today });
    expect(rangeForPreset('threeDays', today)).toEqual({ from: '2026-11-10', to: today });
    expect(rangeForPreset('sevenDays', today)).toEqual({ from: '2026-11-06', to: today });
    expect(rangeForPreset('thirtyDays', today)).toEqual({ from: '2026-10-14', to: today });
  });

  it('预设按钮顺序固定，默认区间为近 3 天', () => {
    expect(QUICK_PRESETS.map((preset) => preset.key)).toEqual([
      'today',
      'threeDays',
      'sevenDays',
      'thirtyDays',
    ]);
    expect(DEFAULT_PRESET).toBe('threeDays');
    expect(rangeForPreset(DEFAULT_PRESET, today)).toEqual({
      from: '2026-11-10',
      to: today,
    });
  });

  it('matchPreset 命中预设区间，其它区间返回 null', () => {
    for (const preset of QUICK_PRESETS) {
      const range = rangeForPreset(preset.key, today);
      expect(matchPreset(range.from ?? '', range.to ?? '', today)).toBe(preset.key);
    }

    expect(matchPreset('2026-11-11', today, today)).toBeNull();
    expect(matchPreset('2026-11-10', '2026-11-11', today)).toBeNull();
    expect(matchPreset('', '', today)).toBeNull();
  });

  it('区间端点只有一个与预设相同也不算命中', () => {
    expect(matchPreset('2026-11-10', '2026-11-12', today)).toBe('threeDays');
    expect(matchPreset('2026-11-09', today, today)).toBeNull();
    expect(matchPreset('2026-11-10', '2026-11-13', today)).toBeNull();
  });
});
