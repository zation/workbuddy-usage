export interface HolidayCalendar {
  /** 已核对放假安排的年份；未列出的年份不查表，一律按「周一至周五」判定。 */
  coveredYears: readonly number[];
  /** 法定节假日 YYYY-MM-DD；只在 coveredYears 内的年份生效。 */
  holidays: ReadonlySet<string>;
}

/**
 * 只录已公布的中国法定节假日安排。空集合不表示「该年无节假日」，而是尚未收录；
 * 补充年份时同时更新 coveredYears，并递增 SCHEMA_VERSION 触发数据库重建。
 */
export const CHINA_HOLIDAYS: HolidayCalendar = {
  coveredYears: [],
  holidays: new Set<string>(),
};
