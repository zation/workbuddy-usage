import { useState } from 'react';
import type { BreakdownRow, Filters } from '../../shared/types.ts';
import { DEFAULT_PRESET, QUICK_PRESETS, hasActiveFilters } from '../filters.ts';
import type { PresetKey } from '../filters.ts';
import { ModelDot } from './ModelDot.tsx';
import { Select } from './Select.tsx';
import type { SelectOption } from './Select.tsx';

interface FilterBarProps {
  /** 当前区间命中的快捷预设；自定义区间为 null，四个按钮都不高亮。 */
  activePreset: PresetKey | null;
  filters: Filters;
  groupOptions: BreakdownRow[];
  sessionOptions: BreakdownRow[];
  modelOptions: BreakdownRow[];
  rangeError: string | null;
  onChange: (patch: Partial<Filters>) => void;
  onQuick: (preset: PresetKey) => void;
  onRange: (from: string, to: string) => void;
  onReset: () => void;
}

function dimensionOptions(rows: BreakdownRow[], emptyLabel: string): SelectOption[] {
  return [
    { key: '', name: emptyLabel },
    ...rows.map((row) => ({ key: row.key, name: row.name })),
  ];
}

export function FilterBar({
  activePreset,
  filters,
  groupOptions,
  sessionOptions,
  modelOptions,
  rangeError,
  onChange,
  onQuick,
  onRange,
  onReset,
}: FilterBarProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const isDefault =
    !rangeError && activePreset === DEFAULT_PRESET && !hasActiveFilters(filters);

  return (
    <section className="filter-bar" aria-label="筛选条件">
      <div className="filter-row">
        <div className="filter-field filter-time">
          <span className="filter-label">时间</span>
          <div className="filter-time-controls" role="group" aria-label="时间范围">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="quick-button"
                data-quick={preset.key}
                aria-pressed={activePreset === preset.key}
                onClick={() => onQuick(preset.key)}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className="quick-button"
              data-more=""
              aria-expanded={customOpen}
              aria-controls="custom-date-range"
              onClick={() => setCustomOpen((open) => !open)}
            >
              {customOpen ? '收起' : '更多'}
            </button>
            <div className="date-range" id="custom-date-range" hidden={!customOpen}>
              <input
                type="date"
                aria-label="起始日期"
                value={filters.from ?? ''}
                onChange={(event) => {
                  // 清空即回弹到当前生效值：不写入筛选，也不留空值中间态
                  if (!event.target.value) {
                    event.target.value = filters.from ?? '';
                    return;
                  }
                  onRange(event.target.value, filters.to ?? '');
                }}
              />
              <span className="date-separator">至</span>
              <input
                type="date"
                aria-label="结束日期"
                value={filters.to ?? ''}
                onChange={(event) => {
                  if (!event.target.value) {
                    event.target.value = filters.to ?? '';
                    return;
                  }
                  onRange(filters.from ?? '', event.target.value);
                }}
              />
            </div>
          </div>
        </div>

        <div className="filter-field">
          <label htmlFor="filter-group">分组</label>
          <Select
            id="filter-group"
            label="分组"
            options={dimensionOptions(groupOptions, '全部分组')}
            value={filters.group ?? ''}
            onChange={(value) => onChange({ group: value || undefined })}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="filter-session">对话</label>
          <Select
            id="filter-session"
            label="对话"
            options={dimensionOptions(sessionOptions, '全部对话')}
            value={filters.session ?? ''}
            onChange={(value) => onChange({ session: value || undefined })}
          />
        </div>

        <div className="filter-field">
          <label htmlFor="filter-model">模型</label>
          <Select
            id="filter-model"
            label="模型"
            options={dimensionOptions(modelOptions, '全部模型')}
            value={filters.model ?? ''}
            onChange={(value) => onChange({ model: value || undefined })}
            renderLeading={(key) => <ModelDot modelKey={key} />}
          />
        </div>

        <div className="filter-field filter-reset">
          <span className="filter-label" aria-hidden="true">
            &nbsp;
          </span>
          <button type="button" className="ghost-button" onClick={onReset} disabled={isDefault}>
            重置
          </button>
        </div>
      </div>

      {rangeError ? <p className="filter-error">{rangeError}</p> : null}
    </section>
  );
}
