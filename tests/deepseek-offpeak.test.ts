import { describe, expect, it } from 'vitest';
import { CHINA_HOLIDAYS, type HolidayCalendar } from '../src/shared/china-holidays.ts';
import { BUSINESS_TZ_OFFSET_MS } from '../src/shared/constants.ts';
import { isDeepseekOffpeak } from '../src/shared/deepseek-offpeak.ts';

const beijing = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 10, day, hour, minute) - BUSINESS_TZ_OFFSET_MS;

describe('DeepSeek 闲时判定', () => {
  it('工作日高峰区间判为高峰，边界左闭右开', () => {
    expect(isDeepseekOffpeak(beijing(9, 8, 59))).toBe(true);
    expect(isDeepseekOffpeak(beijing(9, 9))).toBe(false);
    expect(isDeepseekOffpeak(beijing(9, 11, 59))).toBe(false);
    expect(isDeepseekOffpeak(beijing(9, 12))).toBe(true);
    expect(isDeepseekOffpeak(beijing(9, 13, 59))).toBe(true);
    expect(isDeepseekOffpeak(beijing(9, 14))).toBe(false);
    expect(isDeepseekOffpeak(beijing(9, 17, 59))).toBe(false);
    expect(isDeepseekOffpeak(beijing(9, 18))).toBe(true);
  });

  it('周末全天空闲', () => {
    expect(isDeepseekOffpeak(beijing(14, 10))).toBe(true);
    expect(isDeepseekOffpeak(beijing(15, 10))).toBe(true);
  });

  it('按 UTC+8 折算，UTC 跨日不影响业务日判定', () => {
    expect(isDeepseekOffpeak(Date.UTC(2026, 10, 8, 16))).toBe(true);
    expect(isDeepseekOffpeak(Date.UTC(2026, 10, 9, 1))).toBe(false);
    expect(isDeepseekOffpeak(Date.UTC(2026, 10, 9, 10))).toBe(true);
  });

  it('已收录年份的法定节假日全天空闲', () => {
    const calendar: HolidayCalendar = {
      coveredYears: [2026],
      holidays: new Set(['2026-11-11']),
    };
    expect(isDeepseekOffpeak(beijing(11, 10), calendar)).toBe(true);
    expect(isDeepseekOffpeak(beijing(11, 20), calendar)).toBe(true);
  });

  it('未覆盖年份不查表，按周一至周五判定', () => {
    const calendar: HolidayCalendar = {
      coveredYears: [2027],
      holidays: new Set(['2026-11-11']),
    };
    expect(isDeepseekOffpeak(beijing(11, 10), calendar)).toBe(false);
    expect(CHINA_HOLIDAYS.coveredYears).toEqual([]);
  });
});
