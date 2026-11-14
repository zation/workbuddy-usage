/**
 * 外部 jsonl 字段映射集中在本文件。
 * 只认 integration.md 记录的实测字段；WorkBuddy 改字段时只改这里。
 */

/** 一次模型 API 调用的用量，四项均为该次调用的本步值，不是截至该步的累计快照。 */
export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 缺省或非数字时为 null，由解析层用 input + output 兜底。 */
  totalTokens: number | null;
  /** usage 是否至少包含一个已知 token 字段。 */
  hasAnyField: boolean;
}

/** 一条带 usage 的 jsonl 记录；每次模型调用是一条独立的用量步骤。 */
export interface RawStep {
  requestId: string;
  timestamp: number | null;
  modelKey: string | null;
  modelName: string | null;
  usage: UsageSnapshot;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 读取一条 jsonl 记录；不构成用量步骤时返回 null。 */
export function readStep(record: unknown): RawStep | null {
  const row = asRecord(record);
  if (!row) {
    return null;
  }

  const providerData = asRecord(row.providerData);
  const requestId = providerData ? asText(providerData.conversationRequestId) : null;
  if (!requestId) {
    return null;
  }

  const message = asRecord(row.message);
  const usage = message ? asRecord(message.usage) : null;
  if (!usage || Object.keys(usage).length === 0) {
    return null;
  }

  const inputTokens = asNumber(usage.input_tokens) ?? 0;
  const outputTokens = asNumber(usage.output_tokens) ?? 0;
  const cacheReadTokens = asNumber(usage.cache_read_input_tokens) ?? 0;
  const totalTokens = asNumber(usage.total_tokens);
  const hasAnyField =
    'input_tokens' in usage ||
    'output_tokens' in usage ||
    'cache_read_input_tokens' in usage ||
    'total_tokens' in usage;
  if (!hasAnyField) {
    return null;
  }

  return {
    requestId,
    timestamp: asNumber(row.timestamp),
    modelKey: asText(providerData?.model),
    modelName: asText(providerData?.requestModelName),
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens,
      hasAnyField,
    },
  };
}
