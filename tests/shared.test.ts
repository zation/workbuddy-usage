import { describe, expect, it } from 'vitest';
import { addDays, enumerateDays, isValidDateKey, toDateKey } from '../src/shared/dates.ts';
import type { RefreshResult, RequestRow, SummaryResponse } from '../src/shared/types.ts';
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

describe('共享契约', () => {
  it('刷新结果与 API 类型可被引用且不含内部 id', () => {
    const refreshed: RefreshResult = {
      skipped: false,
      scannedFiles: 2,
      changedFiles: 1,
      upsertedRequests: 3,
      creditAttached: 2,
      durationMs: 12,
      lastRefreshAt: 1,
      warnings: emptyWarnings(),
    };
    const summary: SummaryResponse = {
      from: '2026-11-12',
      to: '2026-11-12',
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
        creditedRequestCount: 1,
        uncreditedRequestCount: 0,
        coverage: 1,
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
      hasCredit: true,
      stepCount: 2,
    };

    expect(refreshed.upsertedRequests).toBe(3);
    expect(summary.credit.coverage).toBe(1);
    expect(Object.keys(row)).not.toContain('id');
  });
});
