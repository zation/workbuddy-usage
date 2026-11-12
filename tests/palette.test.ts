import { describe, expect, it } from 'vitest';
import { MODEL_COLORS } from '../src/web/palette.ts';

describe('模型分类色板', () => {
  it('覆盖当前模型规模且颜色不重复', () => {
    expect(MODEL_COLORS.length).toBeGreaterThanOrEqual(12);
    const normalized = MODEL_COLORS.map((color) => color.toLowerCase());
    expect(new Set(normalized).size).toBe(MODEL_COLORS.length);
    for (const color of MODEL_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
