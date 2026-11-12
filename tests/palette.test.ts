import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODEL_COLORS } from '../src/web/palette.ts';

describe('模型分类色板', () => {
  it('覆盖当前模型规模、颜色不重复且趋势图引用共享色板', () => {
    expect(MODEL_COLORS.length).toBeGreaterThanOrEqual(12);
    const normalized = MODEL_COLORS.map((color) => color.toLowerCase());
    expect(new Set(normalized).size).toBe(MODEL_COLORS.length);
    for (const color of MODEL_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // 防止趋势图改回组件内本地数组，导致色板扩展失效。
    const trendChart = readFileSync(
      new URL('../src/web/components/TrendChart.tsx', import.meta.url),
      'utf8',
    );
    expect(trendChart).toContain('MODEL_COLORS');
  });
});
