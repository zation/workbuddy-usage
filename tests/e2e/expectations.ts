import { DEFAULT_GROUP } from '../../src/shared/constants.ts';
import { enumerateDays, toDateKey } from '../../src/shared/dates.ts';
import { DEEPSEEK_MODEL_KEYS, officialCost, wbCost } from '../../src/shared/deepseek-pricing.ts';
import { isDeepseekOffpeak } from '../../src/shared/deepseek-offpeak.ts';
import { formatCredit, formatInteger, formatPercent, formatTokens } from '../../src/web/format.ts';
import { modelColor } from '../../src/web/model-colors.ts';
import type { SampleRequest, SampleSession } from './sample.ts';
import { SAMPLE_REQUESTS, SAMPLE_SESSIONS, sampleTimestamp } from './sample.ts';

export type Metric = 'tokens' | 'credit';

export interface ModelTotal {
  key: string;
  name: string;
  tokens: number;
  credit: number;
  color: string;
}

export interface GroupTotal {
  key: string;
  name: string;
  tokens: number;
  credit: number;
  segments: ModelTotal[];
}

export interface SessionTotal {
  key: string;
  name: string;
  tokens: number;
  credit: number;
}

export interface RatioTotal {
  date: string;
  ratio: number;
  /** tooltip 里 `X.XX×` 的字面值。 */
  text: string;
}

export interface RangeExpectation {
  from: string;
  to: string;
  days: string[];
  requests: SampleRequest[];
  token: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    requestCount: number;
    sessionCount: number;
  };
  credit: { credit: number; requestCount: number; sessionCount: number };
  text: {
    totalTokens: string;
    inputTokens: string;
    outputTokens: string;
    cacheReadTokens: string;
    requestCount: string;
    sessionCount: string;
    hitRate: string;
    credit: string;
  };
  /** 全部模型（含 0 值），按展示名排序，与趋势图 series 顺序一致。 */
  models: ModelTotal[];
  /** 当前主指标下可见（非 0）的模型业务键，集合语义与面板 0 值隐藏一致。 */
  visibleModelKeys: (metric: Metric) => string[];
  /** 服务层返回顺序：主指标降序、同值按业务键升序。 */
  orderedModels: (metric: Metric) => ModelTotal[];
  groupRows: (metric: Metric) => GroupTotal[];
  sessionRows: (metric: Metric) => SessionTotal[];
  groupShare: (key: string, metric: Metric) => number;
  /** 某天 tooltip 里的模型行：主指标 > 0，按数额降序。 */
  dayRows: (date: string, metric: Metric) => ModelTotal[];
  /** 价格比率：只含有 DeepSeek 请求的日期，与 /api/timeseries 的 ratios 同口径。 */
  ratios: RatioTotal[];
}

const SESSION_BY_ID = new Map<string, SampleSession>(
  SAMPLE_SESSIONS.map((session) => [session.id, session]),
);

/** 分组业务键与展示名在样本里固定给出，不依赖自动分组判定规则的实现。 */
const GROUP_BY_SESSION: Record<string, { key: string; name: string }> = {
  s1: { key: '/work/alpha', name: 'alpha' },
  s2: { key: '/work/beta', name: 'beta' },
  s3: { key: DEFAULT_GROUP, name: DEFAULT_GROUP },
  s4: { key: '/work/alpha', name: 'alpha' },
  s5: { key: '/work/delta-01', name: 'delta-01' },
  s6: { key: '/work/delta-02', name: 'delta-02' },
  s7: { key: '/work/delta-03', name: 'delta-03' },
  s8: { key: '/work/delta-04', name: 'delta-04' },
  s9: { key: '/work/delta-05', name: 'delta-05' },
  s10: { key: '/work/delta-06', name: 'delta-06' },
  s11: { key: '/work/delta-07', name: 'delta-07' },
};

function value(item: { tokens: number; credit: number }, metric: Metric): number {
  return metric === 'tokens' ? item.tokens : item.credit;
}

function sessionName(session: SampleSession): string {
  return session.customTitle ?? session.title ?? session.id.slice(0, 8);
}

function sortByValueDesc<T extends { tokens: number; credit: number }>(
  items: T[],
  metric: Metric,
  tieKey: (item: T) => string,
): T[] {
  return [...items].sort(
    (left, right) =>
      value(right, metric) - value(left, metric) ||
      right.tokens - left.tokens ||
      tieKey(left).localeCompare(tieKey(right)),
  );
}

export function expectRange(from: string, to: string): RangeExpectation {
  const days = enumerateDays(from, to);
  const requests = SAMPLE_REQUESTS.filter((request) => {
    const date = toDateKey(sampleTimestamp(request.at));
    return date >= from && date <= to;
  });

  const modelMap = new Map<string, ModelTotal>();
  const groupMap = new Map<string, { total: GroupTotal; models: Map<string, ModelTotal> }>();
  const sessionMap = new Map<string, SessionTotal>();
  const dayMap = new Map<string, Map<string, ModelTotal>>();

  for (const request of requests) {
    const tokens = request.input + request.output;
    const date = toDateKey(sampleTimestamp(request.at));

    const model = modelMap.get(request.model) ?? {
      key: request.model,
      name: request.modelName,
      tokens: 0,
      credit: 0,
      color: modelColor(request.model),
    };
    model.tokens += tokens;
    model.credit += request.credit;
    modelMap.set(request.model, model);

    const group = GROUP_BY_SESSION[request.session] ?? { key: '', name: '' };
    const groupEntry =
      groupMap.get(group.key) ??
      { total: { key: group.key, name: group.name, tokens: 0, credit: 0, segments: [] }, models: new Map() };
    groupEntry.total.tokens += tokens;
    groupEntry.total.credit += request.credit;
    const segment = groupEntry.models.get(request.model) ?? {
      key: request.model,
      name: request.modelName,
      tokens: 0,
      credit: 0,
      color: modelColor(request.model),
    };
    segment.tokens += tokens;
    segment.credit += request.credit;
    groupEntry.models.set(request.model, segment);
    groupMap.set(group.key, groupEntry);

    const session = SESSION_BY_ID.get(request.session);
    const sessionEntry = sessionMap.get(request.session) ?? {
      key: request.session,
      name: session ? sessionName(session) : request.session,
      tokens: 0,
      credit: 0,
    };
    sessionEntry.tokens += tokens;
    sessionEntry.credit += request.credit;
    sessionMap.set(request.session, sessionEntry);

    const dayModels = dayMap.get(date) ?? new Map<string, ModelTotal>();
    const dayModel = dayModels.get(request.model) ?? {
      key: request.model,
      name: request.modelName,
      tokens: 0,
      credit: 0,
      color: modelColor(request.model),
    };
    dayModel.tokens += tokens;
    dayModel.credit += request.credit;
    dayModels.set(request.model, dayModel);
    dayMap.set(date, dayModels);
  }

  const models = [...modelMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-CN'),
  );
  const visibleModelKeys = (metric: Metric): string[] =>
    models.filter((model) => value(model, metric) !== 0).map((model) => model.key);

  const totalTokens = models.reduce((sum, model) => sum + model.tokens, 0);
  const totalCredit = models.reduce((sum, model) => sum + model.credit, 0);
  const inputTokens = requests.reduce((sum, request) => sum + request.input, 0);
  const outputTokens = requests.reduce((sum, request) => sum + request.output, 0);
  const cacheReadTokens = requests.reduce((sum, request) => sum + request.cache, 0);
  const sessionCount = new Set(requests.map((request) => request.session)).size;

  const ratioByDate = new Map<string, { credit: number; official: number }>();
  for (const request of requests) {
    if (!DEEPSEEK_MODEL_KEYS.includes(request.model)) {
      continue;
    }
    const timestamp = sampleTimestamp(request.at);
    const date = toDateKey(timestamp);
    const entry = ratioByDate.get(date) ?? { credit: 0, official: 0 };
    entry.credit += request.credit;
    entry.official += officialCost(
      {
        inputTokens: request.input,
        outputTokens: request.output,
        cacheReadTokens: request.cache,
      },
      isDeepseekOffpeak(timestamp),
    );
    ratioByDate.set(date, entry);
  }
  const ratios: RatioTotal[] = [...ratioByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .filter(([, entry]) => entry.official > 0)
    .map(([date, entry]) => {
      const ratio = wbCost(entry.credit, date) / entry.official;
      return { date, ratio, text: `${ratio.toFixed(2)}×` };
    });

  return {
    from,
    to,
    days,
    requests,
    token: {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      requestCount: requests.length,
      sessionCount,
    },
    credit: { credit: totalCredit, requestCount: requests.length, sessionCount },
    text: {
      totalTokens: formatTokens(totalTokens),
      inputTokens: formatTokens(inputTokens),
      outputTokens: formatTokens(outputTokens),
      cacheReadTokens: formatTokens(cacheReadTokens),
      requestCount: formatInteger(requests.length),
      sessionCount: formatInteger(sessionCount),
      hitRate: inputTokens > 0 ? formatPercent(cacheReadTokens / inputTokens) : '—',
      credit: formatCredit(totalCredit),
    },
    models,
    visibleModelKeys,
    orderedModels: (metric) => sortByValueDesc(models, metric, (model) => model.key),
    groupRows: (metric) => {
      const visible = new Set(visibleModelKeys(metric));
      return sortByValueDesc(
        [...groupMap.values()].map((entry) => ({
          ...entry.total,
          segments: sortByValueDesc(
            [...entry.models.values()].filter(
              (segment) => value(segment, metric) > 0 && visible.has(segment.key),
            ),
            metric,
            (segment) => segment.key,
          ),
        })),
        metric,
        (group) => group.key,
      );
    },
    sessionRows: (metric) =>
      sortByValueDesc([...sessionMap.values()], metric, (session) => session.key),
    groupShare: (key, metric) => {
      const group = groupMap.get(key);
      const total = metric === 'tokens' ? totalTokens : totalCredit;
      if (!group || total === 0) {
        return 0;
      }
      return value(group.total, metric) / total;
    },
    dayRows: (date, metric) => {
      const dayModels = dayMap.get(date);
      if (!dayModels) {
        return [];
      }
      return sortByValueDesc(
        [...dayModels.values()].filter((model) => value(model, metric) > 0),
        metric,
        (model) => model.key,
      );
    },
    ratios,
  };
}
