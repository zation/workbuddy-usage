import { UNKNOWN_MODEL } from '../shared/constants.ts';

/**
 * 模型色表是长期识别的一部分：显式色值只增不改，FNV-1a 参数与取模方式一并冻结。
 * 改动任一处都会让已有模型或兜底模型换色，规则与变更记录见 docs/model-colors.md。
 */
interface ModelSeries {
  name: string;
  prefix: string;
  explicit: Record<string, string>;
  reserved: readonly string[];
}

const UNKNOWN_COLOR = '#64748b';

const SERIES_INPUT: ModelSeries[] = [
  {
    name: 'hunyuan',
    prefix: 'hy',
    explicit: {
      hy3: '#054a7f',
      hy4: '#086dba',
      'hy4-free': '#0a89eb',
      'hy4-preview': '#5cb9ff',
      'hy4-preview-f': '#9dd2fb',
    },
    reserved: ['#032f52', '#3aa3e0', '#c8e7fd'],
  },
  {
    name: 'kimi',
    prefix: 'kimi',
    explicit: { 'kimi-k3.1-pro': '#047afe' },
    reserved: ['#035fc4', '#4c9bff', '#a8d3ff'],
  },
  {
    name: 'deepseek',
    prefix: 'deepseek',
    explicit: { 'deepseek-v4.1-flash': '#2243e6' },
    reserved: ['#182f9e', '#5a74f5', '#a3b2ff'],
  },
  {
    name: 'glm',
    prefix: 'glm',
    explicit: { 'glm-5.2': '#736cd3' },
    reserved: ['#5b54b8', '#9a93e6', '#c3bff5'],
  },
  {
    name: 'mimo',
    prefix: 'mimo',
    explicit: { 'mimo-v2.6-pro': '#ff6900' },
    reserved: ['#cc5500', '#ff8c33', '#ffb066'],
  },
  {
    name: 'minimax',
    prefix: 'minimax',
    explicit: { 'minimax-m3.1-flash': '#eb3568' },
    reserved: ['#b81a44', '#ff6b8a', '#ffa3b5'],
  },
  {
    name: 'step',
    prefix: 'step',
    explicit: { 'step-5-preview': '#00f5e7' },
    reserved: ['#00bdb2', '#4dfff3', '#a6fffa'],
  },
];

const SERIES: readonly ModelSeries[] = [...SERIES_INPUT].sort(
  (left, right) => right.prefix.length - left.prefix.length,
);

export const FALLBACK_COLORS: readonly string[] = [
  '#0d9488',
  '#65a30d',
  '#7c2d12',
  '#a21caf',
  '#57534e',
  '#9f1239',
  '#b45309',
  '#0891b2',
];

export const MODEL_COLOR_TABLE: Readonly<Record<string, string>> = Object.fromEntries([
  ...SERIES.flatMap((series) => Object.entries(series.explicit)),
  [UNKNOWN_MODEL, UNKNOWN_COLOR],
]);

export function hashKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function modelSeries(modelKey: string): string | null {
  if (modelKey === UNKNOWN_MODEL) {
    return null;
  }
  if (Object.hasOwn(MODEL_COLOR_TABLE, modelKey)) {
    return SERIES.find((series) => Object.hasOwn(series.explicit, modelKey))?.name ?? null;
  }
  // 前缀按长度降序匹配，minimax 不能落到 mimo 上。
  return SERIES.find((series) => modelKey.startsWith(series.prefix))?.name ?? null;
}

export function modelColor(modelKey: string): string {
  if (Object.hasOwn(MODEL_COLOR_TABLE, modelKey)) {
    return MODEL_COLOR_TABLE[modelKey];
  }
  const series = SERIES.find((item) => modelKey.startsWith(item.prefix));
  const palette = series ? series.reserved : FALLBACK_COLORS;
  return palette[hashKey(modelKey) % palette.length];
}
