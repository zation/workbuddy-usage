import type { BreakdownRow, Filters } from '../../shared/types.ts';
import { PRESETS, hasActiveFilters } from '../filters.ts';
import type { CustomRange, PresetKey } from '../filters.ts';
import { ModelDot } from './ModelDot.tsx';
import { Select } from './Select.tsx';
import type { SelectOption } from './Select.tsx';

interface FilterBarProps {
  preset: PresetKey;
  custom: CustomRange;
  filters: Filters;
  groupOptions: BreakdownRow[];
  sessionOptions: BreakdownRow[];
  modelOptions: BreakdownRow[];
  rangeError: string | null;
  onChange: (patch: Partial<Filters>) => void;
  onPreset: (preset: PresetKey) => void;
  onCustom: (range: CustomRange) => void;
  onReset: () => void;
}

const PRESET_OPTIONS: SelectOption[] = PRESETS.map((item) => ({ key: item.key, name: item.label }));

function dimensionOptions(rows: BreakdownRow[], emptyLabel: string): SelectOption[] {
  return [
    { key: '', name: emptyLabel },
    ...rows.map((row) => ({ key: row.key, name: row.name })),
  ];
}

export function FilterBar({
  preset,
  custom,
  filters,
  groupOptions,
  sessionOptions,
  modelOptions,
  rangeError,
  onChange,
  onPreset,
  onCustom,
  onReset,
}: FilterBarProps) {
  const isDefault = preset === 'today' && !hasActiveFilters(filters);

  return (
    <section className="filter-bar" aria-label="筛选条件">
      <div className="filter-row">
        <div className="filter-field filter-time">
          <label htmlFor="filter-preset">时间</label>
          <div className="filter-time-controls">
            <Select
              id="filter-preset"
              className="select-compact"
              label="时间范围"
              options={PRESET_OPTIONS}
              value={preset}
              onChange={(value) => onPreset(value as PresetKey)}
            />
            {preset === 'custom' ? (
              <div className="date-range">
                <input
                  type="date"
                  aria-label="起始日期"
                  value={custom.from}
                  onChange={(event) => onCustom({ ...custom, from: event.target.value })}
                />
                <span className="date-separator">至</span>
                <input
                  type="date"
                  aria-label="结束日期"
                  value={custom.to}
                  onChange={(event) => onCustom({ ...custom, to: event.target.value })}
                />
              </div>
            ) : null}
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

        <button type="button" className="ghost-button" onClick={onReset} disabled={isDefault}>
          重置
        </button>
      </div>

      {rangeError ? <p className="filter-error">{rangeError}</p> : null}
    </section>
  );
}
