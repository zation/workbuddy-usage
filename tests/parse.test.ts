import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UNKNOWN_MODEL, parseSourceFile } from '../src/etl/parse.ts';
import type { SessionMeta, SourceFileRef } from '../src/shared/types.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

interface StepOptions {
  requestId?: string;
  timestamp?: number | string | null;
  input?: number;
  output?: number;
  cache?: number | null;
  total?: number | null;
  model?: string | null;
  modelName?: string | null;
  type?: string;
  omitRequestId?: boolean;
  omitUsage?: boolean;
}

function stepLine(options: StepOptions): string {
  const usage: Record<string, unknown> = {
    input_tokens: options.input ?? 0,
    output_tokens: options.output ?? 0,
  };
  if (options.cache !== null) {
    usage.cache_read_input_tokens = options.cache ?? 0;
  }
  if (options.total !== null) {
    usage.total_tokens = options.total ?? 0;
  }

  const providerData: Record<string, unknown> = {};
  if (!options.omitRequestId) {
    providerData.conversationRequestId = options.requestId ?? 'r1';
  }
  if (options.model !== null) {
    providerData.model = options.model ?? 'model-a';
  }
  if (options.modelName !== null) {
    providerData.requestModelName = options.modelName ?? 'Model-A';
  }

  return JSON.stringify({
    type: options.type ?? 'function_call',
    timestamp: options.timestamp === undefined ? Date.now() : options.timestamp,
    providerData,
    message: options.omitUsage ? {} : { usage },
    unknownField: { ignored: true },
  });
}

function makeFile(lines: string[], overrides: Partial<SourceFileRef> = {}): SourceFileRef {
  const dir = makeTempDir();
  const path = join(dir, 's1.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return {
    path,
    kind: 'main',
    sessionKey: 's1',
    subSessionKey: null,
    sizeBytes: 0,
    mtimeMs: 0,
    ...overrides,
  };
}

function session(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionKey: 's1',
    cwd: '/work/demo',
    title: '演示',
    customTitle: null,
    model: 'session-model',
    syncedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanupTempDirs();
});

describe('按请求归并', () => {
  it('取 total_tokens 最大那条的四项，含时间末条更小的反例', async () => {
    const at = (hour: number, minute: number, day = 11) =>
      new Date(2026, 10, day, hour, minute).getTime();
    const file = makeFile([
      stepLine({ requestId: 'r1', timestamp: at(23, 50), input: 60, output: 40, cache: 10, total: 100 }),
      stepLine({ requestId: 'r1', timestamp: at(23, 55), input: 150, output: 100, cache: 50, total: 250 }),
      stepLine({ requestId: 'r1', timestamp: at(0, 10, 12), input: 100, output: 80, cache: 20, total: 180 }),
    ]);

    const result = await parseSourceFile(file, new Map([['s1', session()]]));
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      requestId: 'r1',
      inputTokens: 150,
      outputTokens: 100,
      cacheReadTokens: 50,
      totalTokens: 250,
      stepCount: 3,
      startedAt: at(23, 50),
      endedAt: at(0, 10, 12),
      dateKey: '2026-11-11',
      isSubagent: false,
      groupPath: '/work/demo',
      modelKey: 'model-a',
    });
    expect(result.modelNames).toEqual([{ modelKey: 'model-a', name: 'Model-A' }]);
    expect(result.warnings).toEqual({
      invalidJsonLines: 0,
      invalidTimestampSteps: 0,
      tokenMismatchSteps: 0,
      cacheExceedsInputSteps: 0,
      zeroTotalSteps: 0,
      duplicateRequestIds: 0,
      unrecognizedFiles: 0,
    });
  });

  it('total_tokens 缺失时用 input + output 兜底，缓存缺失记 0', async () => {
    const file = makeFile([
      stepLine({ requestId: 'r2', timestamp: Date.now(), input: 10, output: 5, cache: null, total: null }),
    ]);
    const result = await parseSourceFile(file, new Map([['s1', session()]]));
    expect(result.requests[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      totalTokens: 15,
    });
  });

  it('校验 C3 / C4 并累计告警，保留原值', async () => {
    const file = makeFile([
      stepLine({ requestId: 'r3', timestamp: Date.now(), input: 10, output: 5, total: 50 }),
      stepLine({ requestId: 'r4', timestamp: Date.now(), input: 10, output: 5, cache: 100 }),
      stepLine({ requestId: 'r5', timestamp: Date.now(), input: 0, output: 0, total: 0 }),
    ]);
    const result = await parseSourceFile(file, new Map([['s1', session()]]));
    expect(result.requests.find((item) => item.requestId === 'r3')?.totalTokens).toBe(50);
    expect(result.warnings.tokenMismatchSteps).toBe(1);
    expect(result.warnings.cacheExceedsInputSteps).toBe(1);
    expect(result.warnings.zeroTotalSteps).toBe(1);
  });

  it('跳过不完整行与非法时间戳，未知字段与未知事件类型不中断', async () => {
    const file = makeFile([
      '{"broken": ',
      stepLine({ requestId: 'r6', timestamp: 'not-a-number' }),
      stepLine({ requestId: 'r7', timestamp: Date.now(), omitRequestId: true }),
      stepLine({ requestId: 'r8', timestamp: Date.now(), omitUsage: true }),
      stepLine({ requestId: 'r9', timestamp: Date.now(), type: 'never-seen-before' }),
      'not-json-at-all',
    ]);
    const result = await parseSourceFile(file, new Map([['s1', session()]]));
    expect(result.requests.map((item) => item.requestId)).toEqual(['r9']);
    expect(result.warnings.invalidJsonLines).toBe(2);
    expect(result.warnings.invalidTimestampSteps).toBe(1);
  });

  it('模型按请求、会话、未知模型三级回退，分组取会话 cwd', async () => {
    const file = makeFile([
      stepLine({ requestId: 'r10', timestamp: Date.now(), model: null, modelName: null }),
    ]);
    const withSession = await parseSourceFile(file, new Map([['s1', session()]]));
    expect(withSession.requests[0]?.modelKey).toBe('session-model');
    expect(withSession.requests[0]?.groupPath).toBe('/work/demo');

    const withoutSession = await parseSourceFile(file, new Map());
    expect(withoutSession.requests[0]?.modelKey).toBe(UNKNOWN_MODEL);
    expect(withoutSession.requests[0]?.groupPath).toBeNull();
  });

  it('子代理请求归入父会话并标记 is_subagent', async () => {
    const file = makeFile(
      [stepLine({ requestId: 'r11', timestamp: Date.now(), model: 'm-sub', modelName: 'M-Sub' })],
      { kind: 'subagent', sessionKey: 'parent1', subSessionKey: 'agent-a' },
    );
    const result = await parseSourceFile(file, new Map([['parent1', session({ sessionKey: 'parent1' })]]));
    expect(result.requests[0]).toMatchObject({
      sessionKey: 'parent1',
      isSubagent: true,
      groupPath: '/work/demo',
      modelKey: 'm-sub',
    });
  });

  it('同一请求跨步骤取最大值，重复解析结果稳定', async () => {
    const lines = [
      stepLine({ requestId: 'r12', timestamp: 1000, input: 1, output: 1, total: 2 }),
      stepLine({ requestId: 'r12', timestamp: 2000, input: 5, output: 5, total: 10 }),
    ];
    const file = makeFile(lines);
    const first = await parseSourceFile(file, new Map());
    const second = await parseSourceFile(file, new Map());
    expect(first.requests).toEqual(second.requests);
    expect(first.requests[0]?.totalTokens).toBe(10);
    expect(first.requests[0]?.stepCount).toBe(2);
  });
});
