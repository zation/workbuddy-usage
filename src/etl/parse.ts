import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { toDateKey } from '../shared/dates.ts';
import { UNKNOWN_MODEL } from '../shared/constants.ts';
import type {
  ModelNameCandidate,
  ParsedRequest,
  ParseWarnings,
  SessionMeta,
  SourceFileRef,
} from '../shared/types.ts';
import { emptyWarnings } from '../shared/types.ts';
import { readStep } from './fields.ts';

export interface FileParseResult {
  requests: ParsedRequest[];
  modelNames: ModelNameCandidate[];
  warnings: ParseWarnings;
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
  stepCount: number;
  bestModelKey: string | null;
  bestModelName: string | null;
  firstModelKey: string | null;
  firstModelName: string | null;
}

function mergeStep(merged: MergedRequest | undefined, step: ReturnType<typeof readStep>): MergedRequest {
  if (!step) {
    throw new Error('mergeStep 只接受已识别的用量步骤');
  }
  const timestamp = step.timestamp ?? 0;

  let totalTokens = step.usage.totalTokens;
  if (totalTokens === null || totalTokens === 0) {
    totalTokens = step.usage.inputTokens + step.usage.outputTokens;
  }

  const target: MergedRequest = merged ?? {
    requestId: step.requestId,
    startedAt: timestamp,
    endedAt: timestamp,
    stepCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: -1,
    bestModelKey: null,
    bestModelName: null,
    firstModelKey: null,
    firstModelName: null,
  };

  target.startedAt = Math.min(target.startedAt, timestamp);
  target.endedAt = Math.max(target.endedAt, timestamp);
  target.stepCount += 1;

  if (!target.firstModelKey && step.modelKey) {
    target.firstModelKey = step.modelKey;
    target.firstModelName = step.modelName;
  }

  // C2：只按 total_tokens 最大值替换，四项字段整体同源，不按时间末条。
  if (totalTokens > target.totalTokens) {
    target.totalTokens = totalTokens;
    target.inputTokens = step.usage.inputTokens;
    target.outputTokens = step.usage.outputTokens;
    target.cacheReadTokens = step.usage.cacheReadTokens;
    target.bestModelKey = step.modelKey;
    target.bestModelName = step.modelName;
  }

  return target;
}

/** 逐行解析一个 jsonl 文件，按 conversationRequestId 归并为请求级记录。 */
export async function parseSourceFile(
  file: SourceFileRef,
  sessions: Map<string, SessionMeta>,
): Promise<FileParseResult> {
  const warnings = emptyWarnings();
  const merged = new Map<string, MergedRequest>();

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

      const inputTokens = step.usage.inputTokens;
      const outputTokens = step.usage.outputTokens;
      const cacheReadTokens = step.usage.cacheReadTokens;
      let totalTokens = step.usage.totalTokens;
      if (totalTokens === null || totalTokens === 0) {
        totalTokens = inputTokens + outputTokens;
      }

      if (totalTokens === 0) {
        warnings.zeroTotalSteps += 1;
      }
      if (totalTokens !== inputTokens + outputTokens) {
        warnings.tokenMismatchSteps += 1;
      }
      if (cacheReadTokens > inputTokens) {
        warnings.cacheExceedsInputSteps += 1;
      }

      merged.set(step.requestId, mergeStep(merged.get(step.requestId), step));
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  const session = sessions.get(file.sessionKey);
  const requests: ParsedRequest[] = [];
  const modelNames: ModelNameCandidate[] = [];

  for (const item of merged.values()) {
    const modelKey =
      item.bestModelKey ?? item.firstModelKey ?? session?.model ?? UNKNOWN_MODEL;
    const modelName = item.bestModelKey ? item.bestModelName : item.firstModelName;
    if (modelName && modelKey !== UNKNOWN_MODEL) {
      modelNames.push({ modelKey, name: modelName });
    }

    requests.push({
      requestId: item.requestId,
      sessionKey: file.sessionKey,
      groupPath: session?.cwd ?? null,
      modelKey,
      isSubagent: file.kind === 'subagent',
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      dateKey: toDateKey(item.startedAt),
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cacheReadTokens: item.cacheReadTokens,
      totalTokens: item.totalTokens,
      stepCount: item.stepCount,
    });
  }

  requests.sort((left, right) => left.requestId.localeCompare(right.requestId));
  return { requests, modelNames, warnings };
}
