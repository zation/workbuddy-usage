import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { CHINA_HOLIDAYS, type HolidayCalendar } from '../shared/china-holidays.ts';
import { isDeepseekOffpeak } from '../shared/deepseek-offpeak.ts';
import { toDateKey } from '../shared/dates.ts';
import { UNKNOWN_MODEL } from '../shared/constants.ts';
import type {
  ModelNameCandidate,
  ParsedRequest,
  ParsedStep,
  ParseWarnings,
  SessionMeta,
  SourceFileRef,
} from '../shared/types.ts';
import { emptyWarnings } from '../shared/types.ts';
import { readStep, type RawStep, type UsageSnapshot } from './fields.ts';

/** 解析期告警在刷新汇总之外多一个多模型计数；R9 要求 refresh 响应形状不变。 */
export interface FileParseWarnings extends ParseWarnings {
  multiModelRequests: number;
}

export interface FileParseResult {
  requests: ParsedRequest[];
  modelNames: ModelNameCandidate[];
  warnings: FileParseWarnings;
}

interface TokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

interface MergedRequest extends TokenSnapshot {
  requestId: string;
  startedAt: number;
  endedAt: number;
  steps: ParsedStep[];
  firstModelKey: string | null;
  firstModelName: string | null;
  multiModel: boolean;
}

function emptyFileWarnings(): FileParseWarnings {
  return { ...emptyWarnings(), multiModelRequests: 0 };
}

function resolveTotalTokens(usage: UsageSnapshot): number {
  return usage.totalTokens === null || usage.totalTokens === 0
    ? usage.inputTokens + usage.outputTokens
    : usage.totalTokens;
}

function mergeStep(
  merged: MergedRequest | undefined,
  step: RawStep,
  isSubagent: boolean,
  calendar: HolidayCalendar,
): MergedRequest {
  const timestamp = step.timestamp ?? 0;
  const totalTokens = resolveTotalTokens(step.usage);

  const target: MergedRequest = merged ?? {
    requestId: step.requestId,
    startedAt: timestamp,
    endedAt: timestamp,
    steps: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    firstModelKey: null,
    firstModelName: null,
    multiModel: false,
  };

  target.startedAt = Math.min(target.startedAt, timestamp);
  target.endedAt = Math.max(target.endedAt, timestamp);
  target.inputTokens += step.usage.inputTokens;
  target.outputTokens += step.usage.outputTokens;
  target.cacheReadTokens += step.usage.cacheReadTokens;
  target.totalTokens += totalTokens;

  if (!target.firstModelKey && step.modelKey) {
    target.firstModelKey = step.modelKey;
    target.firstModelName = step.modelName;
  } else if (step.modelKey && target.firstModelKey && step.modelKey !== target.firstModelKey) {
    target.multiModel = true;
  }

  target.steps.push({
    stepIndex: target.steps.length,
    timestamp,
    model: step.modelKey,
    isSubagent,
    isDeepseekOffpeak: isDeepseekOffpeak(timestamp, calendar),
    inputTokens: step.usage.inputTokens,
    outputTokens: step.usage.outputTokens,
    cacheReadTokens: step.usage.cacheReadTokens,
    totalTokens,
  });

  return target;
}

/** 逐行解析一个 jsonl 文件，按 conversationRequestId 归并为请求级记录。 */
export async function parseSourceFile(
  file: SourceFileRef,
  sessions: Map<string, SessionMeta>,
  calendar: HolidayCalendar = CHINA_HOLIDAYS,
): Promise<FileParseResult> {
  const warnings = emptyFileWarnings();
  const merged = new Map<string, MergedRequest>();
  const isSubagent = file.kind === 'subagent';

  const stream = createReadStream(file.path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        warnings.invalidJsonLines += 1;
        continue;
      }

      const step = readStep(record);
      if (!step) {
        continue;
      }
      if (step.timestamp === null) {
        warnings.invalidTimestampSteps += 1;
        continue;
      }

      if (resolveTotalTokens(step.usage) === 0) {
        warnings.zeroTotalSteps += 1;
      }

      merged.set(
        step.requestId,
        mergeStep(merged.get(step.requestId), step, isSubagent, calendar),
      );
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  const session = sessions.get(file.sessionKey);
  const requests: ParsedRequest[] = [];
  const modelNames: ModelNameCandidate[] = [];

  for (const item of merged.values()) {
    // C3 / C4 校验写入库前的请求级求和结果，不再是逐条快照。
    if (item.totalTokens !== item.inputTokens + item.outputTokens) {
      warnings.tokenMismatchSteps += 1;
    }
    if (item.cacheReadTokens > item.inputTokens) {
      warnings.cacheExceedsInputSteps += 1;
    }

    const modelKey = item.firstModelKey ?? session?.model ?? UNKNOWN_MODEL;
    const modelName = item.firstModelName;
    if (modelName && modelKey !== UNKNOWN_MODEL) {
      modelNames.push({ modelKey, name: modelName });
    }
    if (item.multiModel) {
      warnings.multiModelRequests += 1;
    }

    requests.push({
      requestId: item.requestId,
      sessionKey: file.sessionKey,
      groupPath: session?.cwd ?? null,
      modelKey,
      isSubagent,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      dateKey: toDateKey(item.startedAt),
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheReadTokens: item.cacheReadTokens,
      totalTokens: item.totalTokens,
      stepCount: item.steps.length,
      steps: item.steps,
    });
  }

  requests.sort((left, right) => left.requestId.localeCompare(right.requestId));
  return { requests, modelNames, warnings };
}
