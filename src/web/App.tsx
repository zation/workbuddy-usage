import { useMemo, useState } from 'react';
import type { BreakdownResponse, BreakdownRow, Filters } from '../shared/types.ts';
import { filterParams } from './api.ts';
import { BreakdownList } from './components/BreakdownList.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import type { ActiveChip } from './components/FilterBar.tsx';
import { ModuleSection } from './components/ModuleSection.tsx';
import { rangeForPreset, todayKey } from './filters.ts';
import type { CustomRange, PresetKey } from './filters.ts';
import { useQuery } from './useQuery.ts';

type DrillDimension = 'group' | 'session' | 'model';

function labelOf(rows: BreakdownRow[], key: string): string {
  return rows.find((row) => row.key === key)?.name ?? key;
}

export function App() {
  const today = useMemo(() => todayKey(), []);
  const [preset, setPreset] = useState<PresetKey>('today');
  const [custom, setCustom] = useState<CustomRange>({ from: today, to: today });
  const [filters, setFilters] = useState<Filters>(() =>
    rangeForPreset('today', today, { from: today, to: today }),
  );
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [detailSession, setDetailSession] = useState<string | null>(null);

  const query = filterParams(filters);
  const groupRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=group&${query}`);
  const sessionRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=session&${query}`);
  const modelRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=model&${query}`);

  const groupOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=group&${filterParams({ ...filters, group: undefined })}`,
  );
  const sessionOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=session&${filterParams({ ...filters, session: undefined })}`,
  );
  const modelOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=model&${filterParams({ ...filters, model: undefined })}`,
  );

  const optionGroups = groupOptions.data?.rows ?? [];
  const optionSessions = sessionOptions.data?.rows ?? [];
  const optionModels = modelOptions.data?.rows ?? [];

  const chips: ActiveChip[] = [];
  if (filters.group) {
    chips.push({ dimension: 'group', key: filters.group, label: labelOf(optionGroups, filters.group) });
  }
  if (filters.session) {
    chips.push({
      dimension: 'session',
      key: filters.session,
      label: labelOf(optionSessions, filters.session),
    });
  }
  if (filters.model) {
    chips.push({ dimension: 'model', key: filters.model, label: labelOf(optionModels, filters.model) });
  }

  const patchFilters = (patch: Partial<Filters>) => {
    if ('session' in patch && !patch.session) {
      setDetailSession(null);
    }
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  const handlePreset = (next: PresetKey) => {
    setPreset(next);
    setRangeError(null);
    setFilters(rangeForPreset(next, today, custom));
  };

  const handleCustom = (range: CustomRange) => {
    setCustom(range);
    const invalid = Boolean(range.from && range.to && range.from > range.to);
    setRangeError(invalid ? '起始日期不能晚于结束日期' : null);
    if (preset === 'custom' && !invalid) {
      setFilters((previous) => ({
        ...previous,
        from: range.from || undefined,
        to: range.to || undefined,
      }));
    }
  };

  const handleReset = () => {
    setPreset('today');
    setCustom({ from: today, to: today });
    setRangeError(null);
    setDetailSession(null);
    setFilters(rangeForPreset('today', today, { from: today, to: today }));
  };

  const drill = (dimension: DrillDimension, key: string, moduleId: string) => {
    setFilters((previous) => ({ ...previous, [dimension]: key }));
    if (dimension === 'session') {
      setDetailSession(key);
      return;
    }
    document.getElementById(moduleId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const detailName = detailSession
    ? labelOf(sessionRows.data?.rows ?? optionSessions, detailSession)
    : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>WorkBuddy 用量统计</h1>
          <p>本机只读数据 · 按请求归并核算 · Token 与积分分模块呈现</p>
        </div>
        <span className="source-badge">本地数据</span>
      </header>

      <FilterBar
        preset={preset}
        custom={custom}
        filters={filters}
        groupOptions={optionGroups}
        sessionOptions={optionSessions}
        modelOptions={optionModels}
        chips={chips}
        rangeError={rangeError}
        onChange={patchFilters}
        onPreset={handlePreset}
        onCustom={handleCustom}
        onClear={(dimension) => patchFilters({ [dimension]: undefined })}
        onReset={handleReset}
      />

      {detailSession ? (
        <div className="detail-banner" id="detail-panel">
          <div>
            <span className="detail-eyebrow">会话明细</span>
            <strong>{detailName}</strong>
          </div>
          <button type="button" className="ghost-button" onClick={() => patchFilters({ session: undefined })}>
            退出会话明细
          </button>
        </div>
      ) : null}

      <ModuleSection
        id="token-module"
        accent="token"
        title="Token 用量"
        description="按请求取累计值最大的一条，输入 / 输出 / 缓存命中与合计同源。"
      >
        <div className="panel-grid">
          <BreakdownList
            title="按分组"
            metric="tokens"
            rows={groupRows.data?.rows ?? []}
            loading={groupRows.loading}
            error={groupRows.error}
            emptyText="当前筛选下没有分组数据"
            onSelect={(key) => drill('group', key, 'token-module')}
          />
          <BreakdownList
            title="按对话"
            metric="tokens"
            rows={sessionRows.data?.rows ?? []}
            loading={sessionRows.loading}
            error={sessionRows.error}
            emptyText="当前筛选下没有对话数据"
            onSelect={(key) => drill('session', key, 'token-module')}
          />
          <BreakdownList
            title="按模型"
            metric="tokens"
            rows={modelRows.data?.rows ?? []}
            loading={modelRows.loading}
            error={modelRows.error}
            emptyText="当前筛选下没有模型数据"
            onSelect={(key) => drill('model', key, 'token-module')}
          />
        </div>
      </ModuleSection>

      <ModuleSection
        id="credit-module"
        accent="credit"
        title="积分消耗"
        description="请求级积分与覆盖率；无本地记账按 0 计，子代理请求不在本地记账。"
      >
        <div className="panel-grid">
          <BreakdownList
            title="按分组"
            metric="credit"
            rows={groupRows.data?.rows ?? []}
            loading={groupRows.loading}
            error={groupRows.error}
            emptyText="当前筛选下没有分组数据"
            onSelect={(key) => drill('group', key, 'credit-module')}
          />
          <BreakdownList
            title="按对话"
            metric="credit"
            rows={sessionRows.data?.rows ?? []}
            loading={sessionRows.loading}
            error={sessionRows.error}
            emptyText="当前筛选下没有对话数据"
            onSelect={(key) => drill('session', key, 'credit-module')}
          />
          <BreakdownList
            title="按模型"
            metric="credit"
            rows={modelRows.data?.rows ?? []}
            loading={modelRows.loading}
            error={modelRows.error}
            emptyText="当前筛选下没有模型数据"
            onSelect={(key) => drill('model', key, 'credit-module')}
          />
        </div>
      </ModuleSection>
    </div>
  );
}
