/** 单次查询区间的跨度上限（含首尾天数），前端与 API 共用同一规则。 */
export const MAX_RANGE_DAYS = 100;

/** 业务时区固定为 UTC+8（北京时间，无夏令时）；只在「哪一天」「显示几点」的折算处使用。 */
export const BUSINESS_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

export const UNKNOWN_GROUP = '未知分组';
export const UNKNOWN_MODEL = '未知模型';
/** 自动分组的虚拟业务键与展示名（R5）：不与任何 group_path 相等。 */
export const DEFAULT_GROUP = '默认';
