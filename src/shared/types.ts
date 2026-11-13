/** 会话事件流的来源类型：主会话或子代理会话。 */
export type SourceFileKind = 'main' | 'subagent';

/** 维度筛选只允许分组、对话、模型三种业务键。 */
export type Dimension = 'group' | 'session' | 'model';

/** API 与面板共用的筛选条件，值一律是业务键字符串。 */
export interface Filters {
  from?: string;
  to?: string;
  group?: string;
  session?: string;
  model?: string;
}

/** 扫描阶段确定的文件信息，size / mtime 取自解析前的 stat。 */
export interface SourceFileRef {
  path: string;
  kind: SourceFileKind;
  sessionKey: string;
  subSessionKey: string | null;
  sizeBytes: number;
  mtimeMs: number;
}

/** 外部 sessions 表的一行，供解析层判断分组与模型回退。 */
export interface SessionMeta {
  sessionKey: string;
  cwd: string | null;
  title: string | null;
  customTitle: string | null;
  model: string | null;
  syncedAt: number;
}

/** 解析后按请求归并的记录，字段与 requests 表一一对应，不含内部 id。 */
export interface ParsedRequest {
  requestId: string;
  sessionKey: string;
  groupPath: string | null;
  modelKey: string;
  isSubagent: boolean;
  startedAt: number;
  endedAt: number;
  dateKey: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  stepCount: number;
}

/** 模型展示名候选，用于按固定优先级规范化。 */
export interface ModelNameCandidate {
  modelKey: string;
  name: string;
}

/** 解析期告警计数，随刷新结果返回，便于观察口径异常。 */
export interface ParseWarnings {
  invalidJsonLines: number;
  invalidTimestampSteps: number;
  tokenMismatchSteps: number;
  cacheExceedsInputSteps: number;
  zeroTotalSteps: number;
  duplicateRequestIds: number;
  unrecognizedFiles: number;
}

export function emptyWarnings(): ParseWarnings {
  return {
    invalidJsonLines: 0,
    invalidTimestampSteps: 0,
    tokenMismatchSteps: 0,
    cacheExceedsInputSteps: 0,
    zeroTotalSteps: 0,
    duplicateRequestIds: 0,
    unrecognizedFiles: 0,
  };
}

/** 单次刷新结果，面板刷新入口直接展示这些字段。 */
export interface RefreshResult {
  skipped: boolean;
  scannedFiles: number;
  changedFiles: number;
  upsertedRequests: number;
  creditAttached: number;
  failedFiles: number;
  durationMs: number;
  lastRefreshAt: number | null;
  warnings: ParseWarnings;
}

/** Token 模块的总览指标。 */
export interface TokenMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requestCount: number;
  sessionCount: number;
}

/** 积分模块的总览指标，按请求累加。 */
export interface CreditMetrics {
  credit: number;
  requestCount: number;
  sessionCount: number;
}

export interface SummaryResponse {
  from: string | null;
  to: string | null;
  token: TokenMetrics;
  credit: CreditMetrics;
  /** 上次刷新完成时间，与筛选无关；从未刷新时为 null。 */
  lastRefreshAt: number | null;
}

/** 按天、按模型拆分的序列，days 由服务层补齐连续日期。 */
export interface TimeseriesRow {
  date: string;
  model: string;
  modelName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  credit: number;
  requestCount: number;
}

export interface TimeseriesResponse {
  days: string[];
  rows: TimeseriesRow[];
}

/** 分组行按模型拆出的交叉聚合段，模型只用业务键与展示名。 */
export interface BreakdownSegment {
  model: string;
  modelName: string;
  totalTokens: number;
  credit: number;
}

/** 单维度拆分的聚合行，占比由服务层算好。 */
export interface BreakdownRow {
  key: string;
  name: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  credit: number;
  requestCount: number;
  sessionCount: number;
  tokenShare: number;
  creditShare: number;
  /** 仅 group 维度按 split=model 查询时下发；其它维度与不带 split 时不出现。 */
  models?: BreakdownSegment[];
}

export interface BreakdownResponse {
  dimension: Dimension;
  rows: BreakdownRow[];
}

export type RequestSortField =
  | 'startedAt'
  | 'totalTokens'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'credit';

export type SortOrder = 'asc' | 'desc';

/** 请求级明细行，全部使用业务键与展示名。 */
export interface RequestRow {
  requestId: string;
  date: string;
  startedAt: number;
  endedAt: number;
  group: string;
  groupName: string;
  session: string;
  sessionName: string;
  model: string;
  modelName: string;
  isSubagent: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  credit: number;
  stepCount: number;
}

export interface RequestsResponse {
  rows: RequestRow[];
}

export interface ApiErrorBody {
  error: string;
}
