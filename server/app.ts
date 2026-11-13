import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Refresher } from '../src/etl/refresh.ts';
import { MAX_RANGE_DAYS } from '../src/shared/constants.ts';
import { daySpan, isValidDateKey } from '../src/shared/dates.ts';
import type {
  Dimension,
  Filters,
  RequestSortField,
  SortOrder,
} from '../src/shared/types.ts';
import {
  REQUEST_SORT_FIELDS,
  getBreakdown,
  getRequests,
  getSummary,
  getTimeseries,
} from './query.ts';

export interface AppOptions {
  db: DatabaseSync;
  refresher?: Refresher;
  staticRoot?: string;
}

type FilterResult = { ok: true; filters: Filters } | { ok: false; error: string };

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readFilters(c: Context): FilterResult {
  const from = normalize(c.req.query('from'));
  const to = normalize(c.req.query('to'));
  const group = normalize(c.req.query('group'));
  const session = normalize(c.req.query('session'));
  const model = normalize(c.req.query('model'));

  if (from && !isValidDateKey(from)) {
    return { ok: false, error: 'from 必须是 YYYY-MM-DD 格式的有效日期' };
  }
  if (to && !isValidDateKey(to)) {
    return { ok: false, error: 'to 必须是 YYYY-MM-DD 格式的有效日期' };
  }
  if (from && to && from > to) {
    return { ok: false, error: 'from 不能晚于 to' };
  }
  if (from && to && daySpan(from, to) > MAX_RANGE_DAYS) {
    return { ok: false, error: '时间跨度不能超过 100 天' };
  }

  return { ok: true, filters: { from, to, group, session, model } };
}

function isDimension(value: string): value is Dimension {
  return value === 'group' || value === 'model' || value === 'session';
}

function isSortField(value: string): value is RequestSortField {
  return (REQUEST_SORT_FIELDS as string[]).includes(value);
}

/** 服务层只接受业务键字符串，内部 id 不进入参数或返回值。 */
export function createApp({ db, refresher, staticRoot }: AppOptions): Hono {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/summary', (c) => {
    const parsed = readFilters(c);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json(getSummary(db, parsed.filters));
  });

  app.get('/api/timeseries', (c) => {
    const parsed = readFilters(c);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json(getTimeseries(db, parsed.filters));
  });

  app.get('/api/breakdown', (c) => {
    const dimension = normalize(c.req.query('dim'));
    if (!dimension || !isDimension(dimension)) {
      return c.json({ error: 'dim 必须是 group、model 或 session' }, 400);
    }
    const split = normalize(c.req.query('split'));
    if (split && split !== 'model') {
      return c.json({ error: 'split 只支持 model' }, 400);
    }
    const parsed = readFilters(c);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json(getBreakdown(db, parsed.filters, dimension, split === 'model'));
  });

  app.get('/api/requests', (c) => {
    const sortRaw = normalize(c.req.query('sort')) ?? 'totalTokens';
    if (!isSortField(sortRaw)) {
      return c.json({ error: 'sort 不是支持的排序字段' }, 400);
    }
    const orderRaw = normalize(c.req.query('order')) ?? 'desc';
    if (orderRaw !== 'asc' && orderRaw !== 'desc') {
      return c.json({ error: 'order 必须是 asc 或 desc' }, 400);
    }
    const parsed = readFilters(c);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    return c.json(getRequests(db, parsed.filters, sortRaw, orderRaw as SortOrder));
  });

  app.post('/api/refresh', async (c) => {
    if (!refresher) {
      return c.json({ error: '刷新入口不可用' }, 501);
    }
    try {
      return c.json(await refresher.refresh());
    } catch (error) {
      console.error('刷新失败', error);
      return c.json({ error: '刷新失败，索引保持原状，请查看服务日志' }, 500);
    }
  });

  app.all('/api/*', (c) => c.json({ error: 'Not Found' }, 404));

  if (staticRoot && existsSync(join(staticRoot, 'index.html'))) {
    app.use('*', serveStatic({ root: staticRoot }));
    app.get('*', (c) => c.html(readFileSync(join(staticRoot, 'index.html'), 'utf8')));
  }

  return app;
}
