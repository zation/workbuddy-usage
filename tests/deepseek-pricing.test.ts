import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_MODEL_KEYS,
  DEEPSEEK_MODEL_MAP,
  PRICE_TABLE_VERSION,
  SUBSCRIPTION,
  creditUnitPrice,
  officialCost,
  wbCost,
} from '../src/shared/deepseek-pricing.ts';

describe('套餐与月度单价', () => {
  it('按当月自然日数求额度，覆盖 28 / 29 / 30 / 31 天', () => {
    expect(creditUnitPrice('2026-10-01')).toBeCloseTo(56 / 7100, 10);
    expect(creditUnitPrice('2026-11-01')).toBeCloseTo(56 / 7000, 10);
    expect(creditUnitPrice('2026-02-01')).toBeCloseTo(56 / 6800, 10);
    expect(creditUnitPrice('2024-02-01')).toBeCloseTo(56 / 6900, 10);
  });

  it('同月内每天单价相同，跨月各取各月', () => {
    expect(creditUnitPrice('2026-10-31')).toBe(creditUnitPrice('2026-10-01'));
    expect(creditUnitPrice('2026-10-31')).not.toBe(creditUnitPrice('2026-11-01'));
  });

  it('wbCost 用请求所属月单价，零积分仍为 0', () => {
    expect(wbCost(1000, '2026-10-01')).toBeCloseTo((1000 * 56) / 7100, 10);
    expect(wbCost(0, '2026-10-01')).toBe(0);
  });
});

describe('官方等效费用', () => {
  it('按缓存命中 / 未命中 / 输出三档与闲时档位计算，高峰翻倍', () => {
    const snapshot = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 800_000,
    };
    const expected =
      (800_000 * 0.02 + 200_000 * 1 + 100_000 * 4) / 1_000_000;
    expect(officialCost(snapshot, true)).toBeCloseTo(expected, 10);
    expect(officialCost(snapshot, false)).toBeCloseTo(expected * 2, 10);
  });

  it('缓存命中不超过输入，全 0 时费用为 0', () => {
    expect(officialCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, true)).toBe(0);
    expect(
      officialCost({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 500 }, true),
    ).toBeCloseTo((100 * 0.02) / 1_000_000, 10);
  });
});

describe('价目表与映射', () => {
  it('显式白名单、版本与套餐参数固定', () => {
    expect(DEEPSEEK_MODEL_KEYS).toEqual(['deepseek-v4.1-flash']);
    expect(DEEPSEEK_MODEL_MAP['deepseek-v4.1-flash']).toBe('deepseek-flash');
    expect(PRICE_TABLE_VERSION).toBe('2026-11-14');
    expect(SUBSCRIPTION.annualFeeCny).toBe(672);
    expect(SUBSCRIPTION.dailyCheckinCredits).toBe(100);
  });
});
