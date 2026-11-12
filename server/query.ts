import type { DatabaseSync } from 'node:sqlite';
import { enumerateDays } from '../src/shared/dates.ts';
import type {
  BreakdownResponse,
  BreakdownRow,
  Dimension,
  Filters,
  RequestRow,
  RequestsResponse,
  RequestSortField,
  SortOrder,
  SummaryResponse,
  TimeseriesResponse,
  TimeseriesRow,
} from '../src/shared/types.ts';

const BASE_FROM = `
FROM requests r
LEFT JOIN groups g ON g.id = r.group_id
LEFT JOIN sessions s ON s.id = r.session_id
LEFT JOIN models m ON m.id = r.model_id
`;

const SORT_COLUMNS: Record<RequestSortField, string> = {
  startedAt: 'r.started_at',
  totalTokens: 'r.total_tokens',
  inputTokens: 'r.input_tokens',
  outputTokens: 'r.output_tokens',
  cacheReadTokens: 'r.cache_read_tokens',
  credit: 'r.credit',
};

export const REQUEST_SORT_FIELDS = Object.keys(SORT_COLUMNS) as RequestSortField[];

interface WhereClause {
  where: string;
  params: Array<string | number>;
}

function buildWhere(filters: Filters): WhereClause {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.from) {
    clauses.push('r.date_key >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('r.date_key <= ?');
    params.push(filters.to);
  }
  if (filters.group) {
    clauses.push('g.group_path = ?');
    params.push(filters.group);
  }
  if (filters.session) {
    clauses.push('s.session_key = ?');
    params.push(filters.session);
  }
  if (filters.model) {
    clauses.push('m.model = ?');
    params.push(filters.model);
  }

  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface SummaryRaw {
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  credit: number | null;
  request_count: number;
  session_count: number;
  credited_count: number | null;
}

/** 区间合计；覆盖率以有积分记录的请求数为分子，分母包含子代理请求。 */
export function getSummary(db: DatabaseSync, filters: Filters): SummaryResponse {
  const { where, params } = buildWhere(filters);
  const raw = db
    .prepare(
      `SELECT
         COALESCE(SUM(r.total_tokens), 0) AS total_tokens,
         COALESCE(SUM(r.input_tokens), 0) AS input_tokens,
         COALESCE(SUM(r.output_tokens), 0) AS output_tokens,
         COALESCE(SUM(r.cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(r.credit), 0) AS credit,
         COUNT(*) AS request_count,
         COUNT(DISTINCT r.session_id) AS session_count,
         COALESCE(SUM(r.has_credit), 0) AS credited_count
       ${BASE_FROM} ${where}`,
    )
    .get(...params) as unknown as SummaryRaw;

  const requestCount = number(raw?.request_count);
  const credited = number(raw?.credited_count);
  const credit = number(raw?.credit);

  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    token: {
      totalTokens: number(raw?.total_tokens),
      inputTokens: number(raw?.input_tokens),
      outputTokens: number(raw?.output_tokens),
      cacheReadTokens: number(raw?.cache_read_tokens),
      requestCount,
      sessionCount: number(raw?.session_count),
    },
    credit: {
      credit,
      requestCount,
      sessionCount: number(raw?.session_count),
      creditedRequestCount: credited,
      uncreditedRequestCount: Math.max(0, requestCount - credited),
      coverage: requestCount > 0 ? credited / requestCount : 0,
    },
  };
}

interface TimeseriesRaw {
  date: string;
  model: string;
  model_name: string;
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  credit: number | null;
  request_count: number;
}

/** 固定按天、按模型拆分；堆叠着色由面板按 model 决定。 */
export function getTimeseries(db: DatabaseSync, filters: Filters): TimeseriesResponse {
  const { where, params } = buildWhere(filters);
  const rows = db
    .prepare(
      `SELECT
         r.date_key AS date,
         COALESCE(m.model, '未知模型') AS model,
         COALESCE(m.display_name, m.model, '未知模型') AS model_name,
         SUM(r.total_tokens) AS total_tokens,
         SUM(r.input_tokens) AS input_tokens,
         SUM(r.output_tokens) AS output_tokens,
         SUM(r.cache_read_tokens) AS cache_read_tokens,
         SUM(r.credit) AS credit,
         COUNT(*) AS request_count
       ${BASE_FROM} ${where}
       GROUP BY r.date_key, m.id
       ORDER BY r.date_key ASC, m.id ASC`,
    )
    .all(...params) as unknown as TimeseriesRaw[];

  const mapped: TimeseriesRow[] = rows.map((row) => ({
    date: row.date,
    model: row.model,
    modelName: row.model_name,
    totalTokens: number(row.total_tokens),
    inputTokens: number(row.input_tokens),
    outputTokens: number(row.output_tokens),
    cacheReadTokens: number(row.cache_read_tokens),
    credit: number(row.credit),
    requestCount: number(row.request_count),
  }));

  let days: string[];
  if (mapped.length === 0) {
    days = [];
  } else {
    const dates = mapped.map((row) => row.date).sort();
    const start = filters.from ?? dates[0] ?? '';
    const end = filters.to ?? dates[dates.length - 1] ?? '';
    days = start && end && start <= end ? enumerateDays(start, end) : [];
  }

  return { days, rows: mapped };
}

interface BreakdownRaw {
  key: string | null;
  name: string | null;
  total_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  credit: number | null;
  request_count: number;
  session_count: number;
}

function dimensionColumns(dimension: Dimension): { key: string; name: string; groupBy: string } {
  switch (dimension) {
    case 'group':
      return {
        key: "COALESCE(g.group_path, '未知分组')",
        name: "COALESCE(g.display_name, g.group_path, '未知分组')",
        groupBy: 'g.id',
      };
    case 'model':
      return {
        key: "COALESCE(m.model, '未知模型')",
        name: "COALESCE(m.display_name, m.model, '未知模型')",
        groupBy: 'm.id',
      };
    case 'session':
      return {
        key: "COALESCE(s.session_key, '未知会话')",
        name: "COALESCE(s.display_name, substr(s.session_key, 1, 8), '未知会话')",
        groupBy: 's.id',
      };
  }
}

/** 单维度拆分；筛选值只来自 JOIN 结果，维表中没有请求的行不会出现。 */
export function getBreakdown(
  db: DatabaseSync,
  filters: Filters,
  dimension: Dimension,
): BreakdownResponse {
  const { where, params } = buildWhere(filters);
  const columns = dimensionColumns(dimension);
  const rows = db
    .prepare(
      `SELECT
         ${columns.key} AS key,
         ${columns.name} AS name,
         SUM(r.total_tokens) AS total_tokens,
         SUM(r.input_tokens) AS input_tokens,
         SUM(r.output_tokens) AS output_tokens,
         SUM(r.cache_read_tokens) AS cache_read_tokens,
         SUM(r.credit) AS credit,
         COUNT(*) AS request_count,
         COUNT(DISTINCT r.session_id) AS session_count
       ${BASE_FROM} ${where}
       GROUP BY ${columns.groupBy}
       ORDER BY total_tokens DESC, key ASC`,
    )
    .all(...params) as unknown as BreakdownRaw[];

  const totalTokens = rows.reduce((sum, row) => sum + number(row.total_tokens), 0);
  const totalCredit = rows.reduce((sum, row) => sum + number(row.credit), 0);

  const mapped: BreakdownRow[] = rows.map((row) => {
    const rowTokens = number(row.total_tokens);
    const rowCredit = number(row.credit);
    return {
      key: row.key ?? '',
      name: row.name ?? row.key ?? '',
      totalTokens: rowTokens,
      inputTokens: number(row.input_tokens),
      outputTokens: number(row.output_tokens),
      cacheReadTokens: number(row.cache_read_tokens),
      credit: rowCredit,
      requestCount: number(row.request_count),
      sessionCount: number(row.session_count),
      tokenShare: totalTokens > 0 ? rowTokens / totalTokens : 0,
      creditShare: totalCredit > 0 ? rowCredit / totalCredit : 0,
    };
  });

  return { dimension, rows: mapped };
}

interface RequestRaw {
  request_id: string;
  date_key: string;
  started_at: number;
  ended_at: number;
  group_path: string | null;
  group_name: string | null;
  session_key: string | null;
  session_name: string | null;
  model: string | null;
  model_name: string | null;
  is_subagent: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  credit: number;
  has_credit: number;
  step_count: number;
}

/** 请求级明细，排序在 SQL 完成；返回业务键与展示名。 */
export function getRequests(
  db: DatabaseSync,
  filters: Filters,
  sort: RequestSortField = 'totalTokens',
  order: SortOrder = 'desc',
): RequestsResponse {
  const { where, params } = buildWhere(filters);
  const column = SORT_COLUMNS[sort];
  const direction = order === 'asc' ? 'ASC' : 'DESC';

  const rows = db
    .prepare(
      `SELECT
         r.request_id,
         r.date_key,
         r.started_at,
         r.ended_at,
         r.is_subagent,
         r.input_tokens,
         r.output_tokens,
         r.cache_read_tokens,
         r.total_tokens,
         r.credit,
         r.has_credit,
         r.step_count,
         g.group_path,
         COALESCE(g.display_name, g.group_path, '未知分组') AS group_name,
         s.session_key,
         COALESCE(s.display_name, substr(s.session_key, 1, 8), '未知会话') AS session_name,
         m.model,
         COALESCE(m.display_name, m.model, '未知模型') AS model_name
       ${BASE_FROM} ${where}
       ORDER BY ${column} ${direction}, r.request_id ASC`,
    )
    .all(...params) as unknown as RequestRaw[];

  const mapped: RequestRow[] = rows.map((row) => ({
    requestId: row.request_id,
    date: row.date_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    group: row.group_path ?? '未知分组',
    groupName: row.group_name ?? '未知分组',
    session: row.session_key ?? '未知会话',
    sessionName: row.session_name ?? '未知会话',
    model: row.model ?? '未知模型',
    modelName: row.model_name ?? '未知模型',
    isSubagent: row.is_subagent === 1,
    inputTokens: number(row.input_tokens),
    outputTokens: number(row.output_tokens),
    cacheReadTokens: number(row.cache_read_tokens),
    totalTokens: number(row.total_tokens),
    credit: number(row.credit),
    hasCredit: row.has_credit === 1,
    stepCount: number(row.step_count),
  }));

  return { rows: mapped };
}
