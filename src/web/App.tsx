import { useMemo, useState } from 'react';
import type {
  BreakdownResponse,
  Filters,
  RequestsResponse,
  SummaryResponse,
  TimeseriesResponse,
} from '../shared/types.ts';
import { filterParams, postRefresh } from './api.ts';
import { BreakdownList } from './components/BreakdownList.tsx';
import { FilterBar } from './components/FilterBar.tsx';
import { MetricCards } from './components/MetricCards.tsx';
import type { MetricItem } from './components/MetricCards.tsx';
import { ModuleSection } from './components/ModuleSection.tsx';
import { RequestTable } from './components/RequestTable.tsx';
import type { SortState } from './components/RequestTable.tsx';
import { TrendChart } from './components/TrendChart.tsx';
import { applyPresetRange, rangeForPreset, todayKey } from './filters.ts';
import type { CustomRange, PresetKey } from './filters.ts';
import { formatCredit, formatInteger, formatPercent } from './format.ts';
import { useQuery } from './useQuery.ts';

export function App() {
  const today = useMemo(() => todayKey(), []);
  const [preset, setPreset] = useState<PresetKey>('today');
  const [custom, setCustom] = useState<CustomRange>({ from: today, to: today });
  const [filters, setFilters] = useState<Filters>(() =>
    rangeForPreset('today', today, { from: today, to: today }),
  );
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [tokenSort, setTokenSort] = useState<SortState>({ field: 'totalTokens', order: 'desc' });
  const [creditSort, setCreditSort] = useState<SortState>({ field: 'credit', order: 'desc' });

  const query = filterParams(filters);
  const deps = [version];

  const summary = useQuery<SummaryResponse>(`/api/summary?${query}`, deps);
  const timeseries = useQuery<TimeseriesResponse>(`/api/timeseries?${query}`, deps);
  const groupRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=group&${query}`, deps);
  const sessionRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=session&${query}`, deps);
  const modelRows = useQuery<BreakdownResponse>(`/api/breakdown?dim=model&${query}`, deps);

  const tokenRequests = useQuery<RequestsResponse>(
    `/api/requests?${filterParams(filters, { sort: tokenSort.field, order: tokenSort.order })}`,
    deps,
  );
  const creditRequests = useQuery<RequestsResponse>(
    `/api/requests?${filterParams(filters, { sort: creditSort.field, order: creditSort.order })}`,
    deps,
  );

  const groupOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=group&${filterParams({ ...filters, group: undefined })}`,
    deps,
  );
  const sessionOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=session&${filterParams({ ...filters, session: undefined })}`,
    deps,
  );
  const modelOptions = useQuery<BreakdownResponse>(
    `/api/breakdown?dim=model&${filterParams({ ...filters, model: undefined })}`,
    deps,
  );

  const optionGroups = groupOptions.data?.rows ?? [];
  const optionSessions = sessionOptions.data?.rows ?? [];
  const optionModels = modelOptions.data?.rows ?? [];

  const patchFilters = (patch: Partial<Filters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  const handlePreset = (next: PresetKey) => {
    setPreset(next);
    setRangeError(null);
    setFilters((previous) =>
      applyPresetRange(rangeForPreset(next, today, custom), previous),
    );
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
    setFilters(rangeForPreset('today', today, { from: today, to: today }));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await postRefresh();
      const seconds = (result.durationMs / 1000).toFixed(1);
      const skipped = result.skipped ? '（已有刷新在进行中）' : '';
      setRefreshInfo(
        `扫描 ${result.scannedFiles} 个文件 · 更新 ${result.upsertedRequests} 条请求 · ` +
          `补挂 ${result.creditAttached} 条积分 · 耗时 ${seconds} 秒${skipped}`,
      );
      setVersion((previous) => previous + 1);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const tokenMetrics = summary.data?.token;
  const creditMetrics = summary.data?.credit;

  const tokenItems: MetricItem[] = [
    {
      label: '合计 Token',
      value: tokenMetrics ? formatInteger(tokenMetrics.totalTokens) : '—',
      emphasis: true,
    },
    { label: '输入', value: tokenMetrics ? formatInteger(tokenMetrics.inputTokens) : '—' },
    { label: '输出', value: tokenMetrics ? formatInteger(tokenMetrics.outputTokens) : '—' },
    {
      label: '缓存命中',
      value: tokenMetrics ? formatInteger(tokenMetrics.cacheReadTokens) : '—',
    },
    { label: '请求数', value: tokenMetrics ? formatInteger(tokenMetrics.requestCount) : '—' },
    { label: '会话数', value: tokenMetrics ? formatInteger(tokenMetrics.sessionCount) : '—' },
  ];

  const creditItems: MetricItem[] = [
    {
      label: '积分合计',
      value: creditMetrics ? formatCredit(creditMetrics.credit) : '—',
      emphasis: true,
    },
    {
      label: '覆盖率',
      value: creditMetrics ? formatPercent(creditMetrics.coverage) : '—',
      hint: creditMetrics
        ? `${formatInteger(creditMetrics.creditedRequestCount)} / ${formatInteger(creditMetrics.requestCount)} 请求`
        : undefined,
    },
    {
      label: '请求数',
      value: creditMetrics ? formatInteger(creditMetrics.requestCount) : '—',
    },
    {
      label: '无积分记录',
      value: creditMetrics ? formatInteger(creditMetrics.uncreditedRequestCount) : '—',
      hint: '含全部子代理请求',
    },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>WorkBuddy 用量统计</h1>
          <p>本机只读数据 · 按请求归并核算 · Token 与积分分模块呈现</p>
        </div>
        <div className="header-actions">
          <span className="source-badge">本地数据</span>
          <button
            type="button"
            className="primary-button"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '刷新中…' : '刷新数据'}
          </button>
        </div>
      </header>

      {refreshInfo || refreshError ? (
        <div className={`refresh-strip${refreshError ? ' is-error' : ''}`}>
          {refreshError ?? refreshInfo}
        </div>
      ) : null}

      <FilterBar
        preset={preset}
        custom={custom}
        filters={filters}
        groupOptions={optionGroups}
        sessionOptions={optionSessions}
        modelOptions={optionModels}
        rangeError={rangeError}
        onChange={patchFilters}
        onPreset={handlePreset}
        onCustom={handleCustom}
        onReset={handleReset}
      />

      <ModuleSection
        id="token-module"
        accent="token"
        title="Token 用量"
        description="按请求取累计值最大的一条，输入 / 输出 / 缓存命中与合计同源。"
      >
        <div className="module-block">
          <MetricCards items={tokenItems} />
        </div>
        <div className="module-block">
          <TrendChart
            title="按天 Token 趋势"
            metric="tokens"
            data={timeseries.data}
            loading={timeseries.loading}
            error={timeseries.error}
          />
        </div>
        <div className="panel-grid module-block">
          <BreakdownList
            title="按分组"
            metric="tokens"
            rows={groupRows.data?.rows ?? []}
            loading={groupRows.loading}
            error={groupRows.error}
            emptyText="当前筛选下没有分组数据"
            onSelect={(key) => patchFilters({ group: key })}
          />
          <BreakdownList
            title="按对话"
            metric="tokens"
            rows={sessionRows.data?.rows ?? []}
            loading={sessionRows.loading}
            error={sessionRows.error}
            emptyText="当前筛选下没有对话数据"
            onSelect={(key) => patchFilters({ session: key })}
          />
          <BreakdownList
            title="按模型"
            metric="tokens"
            rows={modelRows.data?.rows ?? []}
            loading={modelRows.loading}
            error={modelRows.error}
            emptyText="当前筛选下没有模型数据"
            onSelect={(key) => patchFilters({ model: key })}
          />
        </div>
        <div className="module-block">
          <RequestTable
            title="Token 请求明细"
            rows={tokenRequests.data?.rows ?? []}
            loading={tokenRequests.loading}
            error={tokenRequests.error}
            sort={tokenSort}
            onSort={(field, order) => setTokenSort({ field, order })}
            emptyText="当前筛选下没有请求"
          />
        </div>
      </ModuleSection>

      <ModuleSection
        id="credit-module"
        accent="credit"
        title="积分消耗"
        description="请求级积分与覆盖率；无本地记账按 0 计，不补齐、不追溯。"
      >
        <p className="module-note">
          覆盖率 {creditMetrics ? formatPercent(creditMetrics.coverage) : '—'} · 有积分记录{' '}
          {creditMetrics ? formatInteger(creditMetrics.creditedRequestCount) : '—'} /{' '}
          {creditMetrics ? formatInteger(creditMetrics.requestCount) : '—'} 请求 · 子代理请求无本地积分记录
        </p>
        <div className="module-block">
          <MetricCards items={creditItems} />
        </div>
        <div className="module-block">
          <TrendChart
            title="按天积分趋势"
            metric="credit"
            data={timeseries.data}
            loading={timeseries.loading}
            error={timeseries.error}
          />
        </div>
        <div className="panel-grid module-block">
          <BreakdownList
            title="按分组"
            metric="credit"
            rows={groupRows.data?.rows ?? []}
            loading={groupRows.loading}
            error={groupRows.error}
            emptyText="当前筛选下没有分组数据"
            onSelect={(key) => patchFilters({ group: key })}
          />
          <BreakdownList
            title="按对话"
            metric="credit"
            rows={sessionRows.data?.rows ?? []}
            loading={sessionRows.loading}
            error={sessionRows.error}
            emptyText="当前筛选下没有对话数据"
            onSelect={(key) => patchFilters({ session: key })}
          />
          <BreakdownList
            title="按模型"
            metric="credit"
            rows={modelRows.data?.rows ?? []}
            loading={modelRows.loading}
            error={modelRows.error}
            emptyText="当前筛选下没有模型数据"
            onSelect={(key) => patchFilters({ model: key })}
          />
        </div>
        <div className="module-block">
          <RequestTable
            title="积分请求明细"
            rows={creditRequests.data?.rows ?? []}
            loading={creditRequests.loading}
            error={creditRequests.error}
            sort={creditSort}
            onSort={(field, order) => setCreditSort({ field, order })}
            emptyText="当前筛选下没有请求"
          />
        </div>
      </ModuleSection>
    </div>
  );
}
