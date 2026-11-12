import type { ReactNode } from 'react';
import type { BreakdownRow, Filters } from '../../shared/types.ts';
import { PRESETS, hasActiveFilters } from '../filters.ts';
import type { CustomRange, PresetKey } from '../filters.ts';

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

function renderOptions(rows: BreakdownRow[], current: string | undefined): ReactNode {
  const options = rows.map((row) => (
    <option key={row.key} value={row.key} title={row.key}>
      {row.name}
    </option>
  ));
  if (current && !rows.some((row) => row.key === current)) {
    options.unshift(
      <option key={current} value={current} title={current}>
        {current}
      </option>,
    );
  }
  return options;
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
            <select
              id="filter-preset"
              value={preset}
              onChange={(event) => onPreset(event.target.value as PresetKey)}
            >
              {PRESETS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
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
          <select
            id="filter-group"
            value={filters.group ?? ''}
            onChange={(event) => onChange({ group: event.target.value || undefined })}
          >
            <option value="">全部分组</option>
            {renderOptions(groupOptions, filters.group)}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="filter-session">对话</label>
          <select
            id="filter-session"
            value={filters.session ?? ''}
            onChange={(event) => onChange({ session: event.target.value || undefined })}
          >
            <option value="">全部对话</option>
            {renderOptions(sessionOptions, filters.session)}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="filter-model">模型</label>
          <select
            id="filter-model"
            value={filters.model ?? ''}
            onChange={(event) => onChange({ model: event.target.value || undefined })}
          >
            <option value="">全部模型</option>
            {renderOptions(modelOptions, filters.model)}
          </select>
        </div>

        <button type="button" className="ghost-button" onClick={onReset} disabled={isDefault}>
          重置
        </button>
      </div>

      {rangeError ? <p className="filter-error">{rangeError}</p> : null}
    </section>
  );
}
