import { CHINA_HOLIDAYS, type HolidayCalendar } from './china-holidays.ts';
import { BUSINESS_TZ_OFFSET_MS } from './constants.ts';
import { toDateKey } from './dates.ts';

/**
 * 按 DeepSeek 官方规则判定请求是否落在空闲时段：北京时间周一至周五、
 * 非中国法定节假日的 09:00-12:00 与 14:00-18:00 为高峰，其余空闲。
 * 列名绑定规则来源，其他模型不得复用本结果。
 */
export function isDeepseekOffpeak(
  startedAt: number,
  calendar: HolidayCalendar = CHINA_HOLIDAYS,
): boolean {
  const business = new Date(startedAt + BUSINESS_TZ_OFFSET_MS);
  const weekday = business.getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return true;
  }

  const dateKey = toDateKey(startedAt);
  const year = Number(dateKey.slice(0, 4));
  if (calendar.coveredYears.includes(year) && calendar.holidays.has(dateKey)) {
    return true;
  }

  const hour = business.getUTCHours();
  const isPeak = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
  return !isPeak;
}
