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
      hy3: '#312e81',
      hy4: '#1d4ed8',
      'hy4-free': '#2563eb',
      'hy4-preview': '#3b82f6',
      'hy4-preview-f': '#60a5fa',
    },
    reserved: ['#1e3a8a', '#6366f1', '#0ea5e9'],
  },
  {
    name: 'kimi',
    prefix: 'kimi',
    explicit: { 'kimi-k3.1-pro': '#16a34a' },
    reserved: ['#15803d', '#4d7c0f', '#65a30d'],
  },
  {
    name: 'deepseek',
    prefix: 'deepseek',
    explicit: { 'deepseek-v4.1-flash': '#ea580c' },
    reserved: ['#c2410c', '#f97316', '#dc2626'],
  },
  {
    name: 'glm',
    prefix: 'glm',
    explicit: { 'glm-5.2': '#db2777' },
    reserved: ['#be185d', '#ec4899', '#c026d3'],
  },
  {
    name: 'mimo',
    prefix: 'mimo',
    explicit: { 'mimo-v2.6-pro': '#7c3aed' },
    reserved: ['#6d28d9', '#9333ea', '#4f46e5'],
  },
  {
    name: 'minimax',
    prefix: 'minimax',
    explicit: { 'minimax-m3.1-flash': '#0d9488' },
    reserved: ['#0f766e', '#14b8a6', '#0891b2'],
  },
  {
    name: 'step',
    prefix: 'step',
    explicit: { 'step-5-preview': '#a16207' },
    reserved: ['#854d0e', '#ca8a04', '#b45309'],
  },
];

const SERIES: readonly ModelSeries[] = [...SERIES_INPUT].sort(
  (left, right) => right.prefix.length - left.prefix.length,
);

export const FALLBACK_COLORS: readonly string[] = [
  '#0284c7',
  '#65a30d',
  '#e11d48',
  '#7c2d12',
  '#0f766e',
  '#a21caf',
  '#57534e',
  '#4338ca',
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
