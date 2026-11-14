import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createWorkbuddyDb } from '../helpers/external-db.ts';
import { stepLine } from '../helpers/jsonl.ts';

/**
 * 验收固定样本：与真实 WorkBuddy 数据同构的最小集合，所有期望值都由本文件的数字推出。
 * 日期固定在 2026-11-14（样本基准日），用例把浏览器 `Date.now` 冻结在该日中午，
 * 因此「今天 / 3 天 / 7 天 / 30 天」与日期轴不随运行日漂移。
 */
export const BASE_DATE = '2026-11-14';

/** 冻结的浏览器时间：基准日 12:00（UTC+8）。 */
export const FROZEN_NOW_MS = Date.UTC(2026, 10, 14, 4, 0, 0);

/** 自动分组目录：`<...>/WorkBuddy/<yyyy-MM-dd-HH-mm-ss>` 形态，服务层聚合成「默认」。 */
export const AUTO_GROUP_PATH = '/Users/demo/WorkBuddy/2026-11-13-09-00-00';

export interface SampleSession {
  id: string;
  cwd: string;
  dir: string;
  title?: string;
  customTitle?: string;
}

/** 一次独立模型调用；一条 jsonl 记录对应一个步骤。 */
export interface SampleStep {
  /** 北京时间 `YYYY-MM-DDTHH:mm`。 */
  at: string;
  input: number;
  output: number;
  cache: number;
}

export interface SampleRequest {
  id: string;
  session: string;
  model: string;
  modelName: string;
  /** 首步时间，同时作为请求日期的业务基准。 */
  at: string;
  input: number;
  output: number;
  cache: number;
  credit: number;
  subagent?: boolean;
  /** 首步之外的额外步骤；请求级四项 token 为全部步骤之和。 */
  steps?: SampleStep[];
}

export function sampleSteps(request: SampleRequest): SampleStep[] {
  return [
    { at: request.at, input: request.input, output: request.output, cache: request.cache },
    ...(request.steps ?? []),
  ];
}

export const SAMPLE_SESSIONS: readonly SampleSession[] = [
  { id: 's1', cwd: '/work/alpha', dir: 'enc-alpha', title: 'Alpha 会话' },
  { id: 's2', cwd: '/work/beta', dir: 'enc-beta', customTitle: '自定义 Beta' },
  { id: 's3', cwd: AUTO_GROUP_PATH, dir: 'enc-auto', title: '自动会话' },
  { id: 's4', cwd: '/work/alpha', dir: 'enc-alpha', title: 'Alpha 会话 2' },
  { id: 's5', cwd: '/work/delta-01', dir: 'enc-delta-01', title: 'Delta 01 会话' },
  { id: 's6', cwd: '/work/delta-02', dir: 'enc-delta-02', title: 'Delta 02 会话' },
  { id: 's7', cwd: '/work/delta-03', dir: 'enc-delta-03', title: 'Delta 03 会话' },
  { id: 's8', cwd: '/work/delta-04', dir: 'enc-delta-04', title: 'Delta 04 会话' },
  { id: 's9', cwd: '/work/delta-05', dir: 'enc-delta-05', title: 'Delta 05 会话' },
  { id: 's10', cwd: '/work/delta-06', dir: 'enc-delta-06', title: 'Delta 06 会话' },
  { id: 's11', cwd: '/work/delta-07', dir: 'enc-delta-07', title: 'Delta 07 会话' },
];

export const SAMPLE_MODELS = {
  deepseek: 'deepseek-v4.1-flash',
  hy4: 'hy4',
  glm: 'glm-5.2',
  mimo: 'mimo-v2.6-pro',
  kimi: 'kimi-k3.1-pro',
} as const;

/**
 * 覆盖：多模型（含 DeepSeek 以触发占位比率折线）、多分组（含自动目录 → 「默认」）、多日期、
 * 全 0 日（11-11）、单模型日（11-12 与 11-10）、极窄段（alpha 里 30 token 的 glm）、
 * 0 值隐藏（kimi 无 token、mimo 无积分）、子代理文件、可手算的缓存命中率。
 * `r-a2` 是跨 09:00 / 12:00 / 14:00 / 18:00 档位的多步 DS 请求，`r-a5` 是多步非 DS 请求，
 * `r-a1` 是额外步骤不抵消、请求级总量真实放大的多步 DS 请求；三者都只落在同一个业务日。
 * `r-a2` / `r-a5` 把原单步拆成多步而保持请求级四项不变，默认区间的图表形状因此不受影响；
 * 放大发生在 11-10（`r-a1`），在默认三天区间之外。额外步骤只用 `message.usage` 四项与 `providerData`。
 */
export const SAMPLE_REQUESTS: readonly SampleRequest[] = [
  { id: 'r-a1', session: 's1', model: SAMPLE_MODELS.deepseek, modelName: 'DeepSeek-V4.1-Flash', at: '2026-11-10T09:00', input: 160, output: 40, cache: 0, credit: 0.1,
    steps: [
      { at: '2026-11-10T09:30', input: 80, output: 20, cache: 40 },
      { at: '2026-11-10T12:30', input: 60, output: 15, cache: 30 },
    ] },
  { id: 'r-a2', session: 's1', model: SAMPLE_MODELS.deepseek, modelName: 'DeepSeek-V4.1-Flash', at: '2026-11-12T10:00', input: 2200, output: 550, cache: 1125, credit: 1.5,
    steps: [
      { at: '2026-11-12T08:59', input: 20, output: 5, cache: 0 },
      { at: '2026-11-12T11:59', input: 30, output: 5, cache: 0 },
      { at: '2026-11-12T12:00', input: 40, output: 10, cache: 20 },
      { at: '2026-11-12T14:00', input: 50, output: 10, cache: 25 },
      { at: '2026-11-12T18:00', input: 60, output: 20, cache: 30 },
    ] },
  { id: 'r-a3', session: 's1', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-13T10:00', input: 800, output: 200, cache: 400, credit: 0.5 },
  { id: 'r-a4', session: 's4', model: SAMPLE_MODELS.glm, modelName: 'GLM-5.2', at: '2026-11-14T10:00', input: 24, output: 6, cache: 0, credit: 0.03 },
  { id: 'r-a5', session: 's4', model: SAMPLE_MODELS.mimo, modelName: 'Mimo-V2.6-Pro', at: '2026-11-13T16:00', input: 240, output: 60, cache: 0, credit: 0,
    steps: [
      { at: '2026-11-13T16:30', input: 100, output: 25, cache: 0 },
      { at: '2026-11-13T19:00', input: 60, output: 15, cache: 0 },
    ] },
  { id: 'r-a6', session: 's1', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-14T11:00', input: 160, output: 40, cache: 0, credit: 0.1, subagent: true },
  { id: 'r-b1', session: 's2', model: SAMPLE_MODELS.deepseek, modelName: 'DeepSeek-V4.1-Flash', at: '2026-11-12T11:00', input: 800, output: 200, cache: 0, credit: 0.8 },
  { id: 'r-b2', session: 's2', model: SAMPLE_MODELS.kimi, modelName: 'Kimi-K3.1-Pro', at: '2026-11-14T15:00', input: 0, output: 0, cache: 0, credit: 0 },
  { id: 'r-c1', session: 's3', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-13T12:00', input: 400, output: 100, cache: 200, credit: 0.25 },
  { id: 'r-g1', session: 's5', model: SAMPLE_MODELS.deepseek, modelName: 'DeepSeek-V4.1-Flash', at: '2026-11-13T09:10', input: 56, output: 14, cache: 0, credit: 0.12 },
  { id: 'r-g2', session: 's6', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-13T09:20', input: 48, output: 12, cache: 0, credit: 0.1 },
  { id: 'r-g3', session: 's7', model: SAMPLE_MODELS.glm, modelName: 'GLM-5.2', at: '2026-11-13T09:30', input: 40, output: 10, cache: 0, credit: 0.08 },
  { id: 'r-g4', session: 's8', model: SAMPLE_MODELS.deepseek, modelName: 'DeepSeek-V4.1-Flash', at: '2026-11-13T09:40', input: 32, output: 8, cache: 0, credit: 0.06 },
  { id: 'r-g5', session: 's9', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-13T09:50', input: 24, output: 6, cache: 0, credit: 0.04 },
  { id: 'r-g6', session: 's10', model: SAMPLE_MODELS.glm, modelName: 'GLM-5.2', at: '2026-11-13T09:55', input: 16, output: 4, cache: 0, credit: 0.03 },
  { id: 'r-g7', session: 's11', model: SAMPLE_MODELS.hy4, modelName: 'Hy4', at: '2026-11-13T09:58', input: 8, output: 2, cache: 0, credit: 0.02 },
];

/** 北京时间 → 绝对时间戳；负的小时数由 Date.UTC 自行回退到前一天。 */
export function sampleTimestamp(local: string): number {
  const [date, time] = local.split('T');
  const [year, month, day] = (date ?? '').split('-').map((part) => Number.parseInt(part, 10));
  const [hour, minute] = (time ?? '').split(':').map((part) => Number.parseInt(part, 10));
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, (hour ?? 0) - 8, minute ?? 0);
}

function writeJsonl(path: string, lines: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}

function toLines(requests: readonly SampleRequest[]): string[] {
  return requests.flatMap((request) =>
    sampleSteps(request).map((step) =>
      stepLine({
        requestId: request.id,
        timestamp: sampleTimestamp(step.at),
        input: step.input,
        output: step.output,
        cache: step.cache,
        total: step.input + step.output,
        model: request.model,
        modelName: request.modelName,
      }),
    ),
  );
}

/** 在给定目录下生成 workbuddy.db 与 projects 会话流；调用方负责先清空目录。 */
export function buildSampleHome(home: string): void {
  mkdirSync(home, { recursive: true });

  const creditsBySession = new Map<string, Record<string, number>>();
  for (const request of SAMPLE_REQUESTS) {
    const credits = creditsBySession.get(request.session) ?? {};
    credits[request.id] = request.credit;
    creditsBySession.set(request.session, credits);
  }

  createWorkbuddyDb(
    home,
    SAMPLE_SESSIONS.map((session) => ({
      id: session.id,
      cwd: session.cwd,
      title: session.title ?? null,
      customTitle: session.customTitle ?? null,
    })),
    SAMPLE_SESSIONS.map((session) => ({
      sessionId: session.id,
      creditJson: JSON.stringify(creditsBySession.get(session.id) ?? {}),
    })),
  );

  for (const session of SAMPLE_SESSIONS) {
    const own = SAMPLE_REQUESTS.filter(
      (request) => request.session === session.id && request.subagent !== true,
    );
    if (own.length > 0) {
      writeJsonl(join(home, 'projects', session.dir, `${session.id}.jsonl`), toLines(own));
    }
  }

  for (const session of SAMPLE_SESSIONS) {
    const subagents = SAMPLE_REQUESTS.filter(
      (request) => request.session === session.id && request.subagent === true,
    );
    if (subagents.length > 0) {
      writeJsonl(
        join(home, 'projects', session.dir, session.id, 'subagents', 'agent-x.jsonl'),
        toLines(subagents),
      );
    }
  }
}
