import { describe, expect, it } from 'vitest';
import type { Filters } from '../src/shared/types.ts';
import { applyPresetRange, rangeForPreset } from '../src/web/filters.ts';

const custom = { from: '2026-11-01', to: '2026-11-02' };

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
    const next = applyPresetRange(
      rangeForPreset('sevenDays', '2026-11-12', custom),
      currentFilters(),
    );
    expect(next).toEqual({
      from: '2026-11-06',
      to: '2026-11-12',
      group: '/work/alpha',
      session: 'sess-1',
      model: 'model-a',
    });
  });

  it('切到全部时清空日期但保留维度筛选', () => {
    const next = applyPresetRange(rangeForPreset('all', '2026-11-12', custom), currentFilters());
    expect(next).toEqual({
      group: '/work/alpha',
      session: 'sess-1',
      model: 'model-a',
    });
  });

  it('各预设的日期区间符合预期', () => {
    expect(rangeForPreset('today', '2026-11-12', custom)).toEqual({
      from: '2026-11-12',
      to: '2026-11-12',
    });
    expect(rangeForPreset('month', '2026-11-12', custom)).toEqual({
      from: '2026-11-01',
      to: '2026-11-12',
    });
    expect(rangeForPreset('custom', '2026-11-12', custom)).toEqual(custom);
  });
});
