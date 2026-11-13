import { describe, expect, it } from 'vitest';
import { MAX_RANGE_DAYS } from '../src/shared/constants.ts';
import { addDays, daySpan, enumerateDays, isValidDateKey, toDateKey } from '../src/shared/dates.ts';
import type { BreakdownRow, RefreshResult, RequestRow, SummaryResponse } from '../src/shared/types.ts';
import { emptyWarnings } from '../src/shared/types.ts';

describe('日期工具', () => {
  it('按本地时区派生日期', () => {
    const localMidnight = new Date(2026, 10, 12, 0, 5, 0).getTime();
    expect(toDateKey(localMidnight)).toBe('2026-11-12');
  });

  it('跨月加减日期', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('枚举含首尾的连续日期', () => {
    expect(enumerateDays('2026-11-10', '2026-11-12')).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  });

  it('校验日期格式与真实性', () => {
    expect(isValidDateKey('2026-11-12')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-1-1')).toBe(false);
  });
});

describe('区间跨度', () => {
  it('按含首尾天数计算', () => {
    expect(daySpan('2026-11-12', '2026-11-12')).toBe(1);
    expect(daySpan('2026-11-10', '2026-11-12')).toBe(3);
  });

  it('跨月与跨年连续计数', () => {
    expect(daySpan('2026-11-30', '2026-12-02')).toBe(3);
    expect(daySpan('2026-12-31', '2027-01-01')).toBe(2);
  });

  it('不受本地时区与夏令时影响', () => {
    expect(daySpan('2026-03-07', '2026-03-09')).toBe(3);
    expect(daySpan('2026-10-31', '2026-11-02')).toBe(3);
  });

  it('上限边界落在 100 与 101', () => {
    const start = '2026-01-01';
    expect(daySpan(start, addDays(start, MAX_RANGE_DAYS - 1))).toBe(100);
    expect(daySpan(start, addDays(start, MAX_RANGE_DAYS))).toBe(101);
  });
});

describe('共享契约', () => {
  it('刷新结果与 API 类型可被引用且不含内部 id', () => {
    const refreshed: RefreshResult = {
      skipped: false,
      scannedFiles: 2,
      changedFiles: 1,
      upsertedRequests: 3,
      creditAttached: 2,
      failedFiles: 0,
      durationMs: 12,
      lastRefreshAt: 1,
      warnings: emptyWarnings(),
    };
    const summary: SummaryResponse = {
      from: '2026-11-12',
      to: '2026-11-12',
      lastRefreshAt: 1,
      token: {
        totalTokens: 10,
        inputTokens: 6,
        outputTokens: 4,
        cacheReadTokens: 2,
        requestCount: 1,
        sessionCount: 1,
      },
      credit: {
        credit: 1.5,
        requestCount: 1,
        sessionCount: 1,
      },
    };
    const row: RequestRow = {
      requestId: 'r1',
      date: '2026-11-12',
      startedAt: 1,
      endedAt: 2,
      group: '/demo',
      groupName: 'demo',
      session: 's1',
      sessionName: '演示',
      model: 'demo-model',
      modelName: 'Demo Model',
      isSubagent: false,
      inputTokens: 6,
      outputTokens: 4,
      cacheReadTokens: 2,
      totalTokens: 10,
      credit: 1.5,
      stepCount: 2,
    };

    expect(refreshed.upsertedRequests).toBe(3);
    expect(summary.credit.credit).toBe(1.5);
    expect(Object.keys(row)).not.toContain('id');
  });

  it('分组行可附带按模型分段的交叉聚合', () => {
    const groupRow: BreakdownRow = {
      key: '默认',
      name: '默认',
      totalTokens: 10,
      inputTokens: 6,
      outputTokens: 4,
      cacheReadTokens: 2,
      credit: 1.5,
      requestCount: 1,
      sessionCount: 1,
      tokenShare: 1,
      creditShare: 1,
      models: [{ model: 'demo-model', modelName: 'Demo Model', totalTokens: 10, credit: 1.5 }],
    };

    expect(groupRow.models).toEqual([
      { model: 'demo-model', modelName: 'Demo Model', totalTokens: 10, credit: 1.5 },
    ]);
    expect(Object.keys(groupRow.models?.[0] ?? {})).not.toContain('id');
  });
});
