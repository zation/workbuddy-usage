import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_MODEL } from '../src/shared/constants.ts';
import {
  FALLBACK_COLORS,
  MODEL_COLOR_TABLE,
  hashKey,
  modelColor,
  modelSeries,
} from '../src/web/model-colors.ts';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const HUNYUAN_KEYS = ['hy3', 'hy4', 'hy4-free', 'hy4-preview', 'hy4-preview-f'];

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function hue(hex: string): number {
  const [red, green, blue] = rgb(hex).map((value) => value / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  const offset =
    max === red ? ((green - blue) / delta) % 6
    : max === green ? (blue - red) / delta + 2
    : (red - green) / delta + 4;
  return (offset * 60 + 360) % 360;
}

function distance(left: string, right: string): number {
  const [lr, lg, lb] = rgb(left);
  const [rr, rg, rb] = rgb(right);
  return Math.hypot(lr - rr, lg - rg, lb - rb);
}

describe('模型显式色表', () => {
  it('覆盖当前 11 个标识与未知模型，色值合法且互不重复', () => {
    const entries = Object.entries(MODEL_COLOR_TABLE);
    expect(entries).toHaveLength(12);
    for (const color of entries.map(([, value]) => value)) {
      expect(color).toMatch(HEX_COLOR);
    }
    expect(new Set(entries.map(([, value]) => value)).size).toBe(entries.length);
    expect(MODEL_COLOR_TABLE[UNKNOWN_MODEL]).toBe('#64748b');
  });

  it('同系列共享相近色相且系列内各档互不相同', () => {
    const colors = HUNYUAN_KEYS.map((key) => MODEL_COLOR_TABLE[key]);
    expect(new Set(colors).size).toBe(colors.length);
    const hues = colors.map(hue);
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(60);
    for (const key of HUNYUAN_KEYS) {
      expect(modelSeries(key)).toBe('hunyuan');
    }
  });

  it('不同系列的基准色两两可辨', () => {
    const bases = [
      MODEL_COLOR_TABLE['hy4'],
      MODEL_COLOR_TABLE['kimi-k3.1-pro'],
      MODEL_COLOR_TABLE['deepseek-v4.1-flash'],
      MODEL_COLOR_TABLE['glm-5.2'],
      MODEL_COLOR_TABLE['mimo-v2.6-pro'],
      MODEL_COLOR_TABLE['minimax-m3.1-flash'],
      MODEL_COLOR_TABLE['step-5-preview'],
      MODEL_COLOR_TABLE[UNKNOWN_MODEL],
    ];
    for (let left = 0; left < bases.length; left += 1) {
      for (let right = left + 1; right < bases.length; right += 1) {
        expect(distance(bases[left], bases[right])).toBeGreaterThan(60);
      }
    }
  });
});

describe('系列归属与兜底', () => {
  it('前缀按长度降序最长匹配，minimax 不落到 mimo', () => {
    expect(modelSeries('mimo-v2.6-pro')).toBe('mimo');
    expect(modelSeries('minimax-m3.1-flash')).toBe('minimax');
    expect(modelSeries('kimi-k4')).toBe('kimi');
    expect(modelSeries('hy5')).toBe('hunyuan');
    expect(modelSeries('mystery-1')).toBeNull();
    expect(modelSeries(UNKNOWN_MODEL)).toBeNull();
  });

  it('显式模型直接查表，新模型按系列或全局兜底取到固定色值', () => {
    expect(modelColor('hy4')).toBe('#086dba');
    expect(modelColor(UNKNOWN_MODEL)).toBe('#64748b');
    expect(modelColor('kimi-k4')).toBe('#035fc4');
    expect(modelColor('hy5')).toBe('#3aa3e0');
    expect(modelColor('glm-6')).toBe('#9a93e6');
    expect(modelColor('new-model-x')).toBe('#57534e');
    expect(modelColor('mystery-1')).toBe('#0d9488');
    expect(FALLBACK_COLORS).toContain(modelColor('new-model-x'));
  });

  it('同一标识重复计算一致，且不因其它模型被调用而改变', () => {
    const first = modelColor('hy4-free');
    for (const key of ['kimi-k4', 'new-model-x', 'hy5', UNKNOWN_MODEL]) {
      modelColor(key);
    }
    expect(modelColor('hy4-free')).toBe(first);
    expect(modelColor('new-model-x')).toBe(modelColor('new-model-x'));
  });

  it('FNV-1a 输出固化，防止算法被无意改动', () => {
    expect(hashKey('abc')).toBe(440920331);
    expect(hashKey('new-model-x')).toBe(1100175028);
    expect(hashKey('mystery-1')).toBe(288094992);
  });
});

describe('文档一致性', () => {
  it('docs/model-colors.md 的显式色表与代码逐项一致', () => {
    const doc = readFileSync(new URL('../docs/model-colors.md', import.meta.url), 'utf8');
    const rows = [
      ...doc.matchAll(/^\|\s*`([^`]+)`\s*\|[^|]*\|\s*`(#[0-9a-f]{6})`\s*\|/gm),
    ].map((match) => [match[1], match[2].toLowerCase()] as const);
    expect(rows).toHaveLength(Object.keys(MODEL_COLOR_TABLE).length);
    expect(Object.fromEntries(rows)).toEqual(MODEL_COLOR_TABLE);
  });
});

describe('色值来源', () => {
  it('组件与面板不在本地内联显式色值', () => {
    const componentDir = new URL('../src/web/components/', import.meta.url);
    const files = [
      ...readdirSync(componentDir)
        .filter((name) => name.endsWith('.tsx'))
        .map((name) => new URL(name, componentDir)),
      new URL('../src/web/App.tsx', import.meta.url),
    ];
    const known = new Set(Object.values(MODEL_COLOR_TABLE).map((color) => color.toLowerCase()));
    for (const file of files) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      for (const color of known) {
        expect(source).not.toContain(color);
      }
    }
  });
});
