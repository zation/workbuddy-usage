export const PRICE_TABLE_VERSION = '2026-11-14';

export const DEEPSEEK_MODEL_MAP = {
  'deepseek-v4.1-flash': 'deepseek-flash',
} as const;

export type OfficialModel = (typeof DEEPSEEK_MODEL_MAP)[keyof typeof DEEPSEEK_MODEL_MAP];

export const DEEPSEEK_MODEL_KEYS: readonly string[] = Object.keys(DEEPSEEK_MODEL_MAP);

interface TierPrices {
  cacheHitInput: number;
  cacheMissInput: number;
  output: number;
}

interface PriceTable {
  offpeak: TierPrices;
  peak: TierPrices;
}

/** 单位「元 / 百万 tokens」；空闲为高峰半价，与 672 元年费同币种。 */
export const PRICE_TABLES: Readonly<Record<OfficialModel, PriceTable>> = {
  'deepseek-flash': {
    offpeak: { cacheHitInput: 0.02, cacheMissInput: 1, output: 4 },
    peak: { cacheHitInput: 0.04, cacheMissInput: 2, output: 8 },
  },
};

export const SUBSCRIPTION = {
  annualFeeCny: 672,
  monthsPerYear: 12,
  monthlyBaseCredits: 4000,
  dailyCheckinCredits: 100,
} as const;

export interface TokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** 请求所属自然月的积分单价；月天数用 UTC 纯日期算术，不依赖机器时区。 */
export function creditUnitPrice(dateKey: string): number {
  const [year, month] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const daysInMonth = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  const quota =
    SUBSCRIPTION.monthlyBaseCredits + SUBSCRIPTION.dailyCheckinCredits * daysInMonth;
  return SUBSCRIPTION.annualFeeCny / SUBSCRIPTION.monthsPerYear / quota;
}

export function wbCost(credit: number, dateKey: string): number {
  return credit * creditUnitPrice(dateKey);
}

/** 三档 token 按闲时档位折算成官方等效费用（元）。 */
export function officialCost(
  snapshot: TokenSnapshot,
  offpeak: boolean,
  officialModel: OfficialModel = 'deepseek-flash',
): number {
  const prices = offpeak ? PRICE_TABLES[officialModel].offpeak : PRICE_TABLES[officialModel].peak;
  const hit = Math.min(snapshot.cacheReadTokens, snapshot.inputTokens);
  const miss = snapshot.inputTokens - hit;
  return (
    (hit * prices.cacheHitInput +
      miss * prices.cacheMissInput +
      snapshot.outputTokens * prices.output) /
    1_000_000
  );
}
