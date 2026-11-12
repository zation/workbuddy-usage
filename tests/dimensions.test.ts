import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DimensionWriter,
  computeModelDisplayNames,
  lastPathSegment,
  sessionDisplayName,
} from '../src/etl/dimensions.ts';
import { closeIndex, openIndex } from '../src/etl/index-db.ts';
import { UNKNOWN_GROUP, UNKNOWN_MODEL } from '../src/shared/constants.ts';
import type { ModelNameCandidate, SessionMeta, SourceFileRef } from '../src/shared/types.ts';
import { cleanupTempDirs, makeTempDir } from './helpers/temp.ts';

const openDbs: Array<ReturnType<typeof openIndex>['db']> = [];

function setup(): { db: ReturnType<typeof openIndex>['db']; writer: DimensionWriter } {
  const dir = makeTempDir();
  const { db } = openIndex(join(dir, '.data', 'index.db'));
  openDbs.push(db);
  return { db, writer: new DimensionWriter(db) };
}

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionKey: 's1',
    cwd: '/work/demo',
    title: '自动标题',
    customTitle: null,
    model: null,
    syncedAt: 1000,
    ...overrides,
  };
}

function rows<T>(db: ReturnType<typeof openIndex>['db'], sql: string): T[] {
  return db.prepare(sql).all() as unknown as T[];
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    if (db) {
      closeIndex(db);
    }
  }
  cleanupTempDirs();
});

describe('展示名规则', () => {
  it('路径末段兼容 POSIX、Windows 与尾部分隔符', () => {
    expect(lastPathSegment('/work/demo')).toBe('demo');
    expect(lastPathSegment('/work/demo/')).toBe('demo');
    expect(lastPathSegment('E:\\Project\\workbuddy-usage')).toBe('workbuddy-usage');
    expect(lastPathSegment('E:\\Project\\workbuddy-usage\\')).toBe('workbuddy-usage');
    expect(lastPathSegment('/')).toBe('/');
  });

  it('会话展示名按自定义标题、标题、ID 前 8 位回退', () => {
    expect(sessionDisplayName({ sessionKey: 'abcdef123456', customTitle: '自定义', title: '标题' })).toBe('自定义');
    expect(sessionDisplayName({ sessionKey: 'abcdef123456', customTitle: null, title: '标题' })).toBe('标题');
    expect(sessionDisplayName({ sessionKey: 'abcdef123456', customTitle: null, title: null })).toBe('abcdef12');
  });

  it('模型展示名取高频大写候选，并列取字典序最小，且与顺序无关', () => {
    const candidates: ModelNameCandidate[] = [
      { modelKey: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' },
      { modelKey: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash' },
      { modelKey: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash' },
      { modelKey: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' },
      { modelKey: 'hy4', name: 'Hy4' },
      { modelKey: 'lower-only', name: 'lower-only' },
      { modelKey: UNKNOWN_MODEL, name: 'Unknown' },
    ];
    const expected = computeModelDisplayNames(candidates);
    expect(expected.get('deepseek-v4.1-flash')).toBe('DeepSeek-V4.1-Flash');
    expect(expected.get('hy4')).toBe('Hy4');
    expect(expected.has('lower-only')).toBe(false);
    expect(expected.has(UNKNOWN_MODEL)).toBe(false);

    const shuffled = [...candidates].reverse();
    expect(Object.fromEntries(computeModelDisplayNames(shuffled))).toEqual(
      Object.fromEntries(expected),
    );
  });

  it('出现次数多的候选优先于字典序', () => {
    const names = computeModelDisplayNames([
      { modelKey: 'm', name: 'Zeta-Model' },
      { modelKey: 'm', name: 'Zeta-Model' },
      { modelKey: 'm', name: 'Alpha-Model' },
    ]);
    expect(names.get('m')).toBe('Zeta-Model');
  });
});

describe('维表 upsert', () => {
  it('分组按业务键唯一，展示名取路径末段', () => {
    const { db, writer } = setup();
    const first = writer.ensureGroup('/work/demo');
    const second = writer.ensureGroup('/work/demo');
    const windows = writer.ensureGroup('E:\\Project\\workbuddy-usage');
    const unknown = writer.ensureGroup(null);

    expect(second).toBe(first);
    expect(rows<{ group_path: string; display_name: string }>(db, 'SELECT * FROM groups')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ group_path: '/work/demo', display_name: 'demo' }),
        expect.objectContaining({ group_path: 'E:\\Project\\workbuddy-usage', display_name: 'workbuddy-usage' }),
        expect.objectContaining({ group_path: UNKNOWN_GROUP, display_name: UNKNOWN_GROUP }),
      ]),
    );
    expect(unknown).toBeGreaterThan(windows);
  });

  it('外部会话同步更新展示名且保留消失的行（C11）', () => {
    const { db, writer } = setup();
    const sessions = new Map<string, SessionMeta>([
      ['s1', meta({ sessionKey: 's1', customTitle: null, title: '标题一' })],
      ['s2', meta({ sessionKey: 's2', customTitle: '自定义二', title: '标题二', cwd: null })],
      ['s3', meta({ sessionKey: 's3', customTitle: null, title: null, cwd: '/work/other' })],
    ]);
    writer.syncExternalSessions(sessions);

    const sessionRows = rows<{ session_key: string; display_name: string; synced_at: number }>(
      db,
      'SELECT session_key, display_name, synced_at FROM sessions ORDER BY session_key',
    );
    expect(sessionRows).toEqual([
      { session_key: 's1', display_name: '标题一', synced_at: 1000 },
      { session_key: 's2', display_name: '自定义二', synced_at: 1000 },
      { session_key: 's3', display_name: 's3', synced_at: 1000 },
    ]);

    writer.syncExternalSessions(
      new Map([['s1', meta({ sessionKey: 's1', title: '标题改', syncedAt: 2000 })]]),
    );
    expect(
      rows<{ display_name: string }>(db, "SELECT display_name FROM sessions WHERE session_key = 's1'"),
    ).toEqual([{ display_name: '标题改' }]);

    writer.syncExternalSessions(new Map());
    expect(rows<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM sessions')).toEqual([{ n: 3 }]);
  });

  it('请求侧缺失会话先建兜底行，外部同步后可升级展示名', () => {
    const { db, writer } = setup();
    writer.ensureSession('abcdef123456');
    expect(
      rows<{ display_name: string; synced_at: number | null }>(
        db,
        "SELECT display_name, synced_at FROM sessions WHERE session_key = 'abcdef123456'",
      ),
    ).toEqual([{ display_name: 'abcdef12', synced_at: null }]);

    writer.syncExternalSessions(
      new Map([['abcdef123456', meta({ sessionKey: 'abcdef123456', title: '真实标题' })]]),
    );
    expect(
      rows<{ display_name: string }>(
        db,
        "SELECT display_name FROM sessions WHERE session_key = 'abcdef123456'",
      ),
    ).toEqual([{ display_name: '真实标题' }]);
  });

  it('模型从原始标识升级到规范名后保持稳定，未知模型有独立行', () => {
    const { db, writer } = setup();
    writer.ensureModel('deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash');
    writer.ensureModel('deepseek-v4.1-flash', 'Deepseek-V4.1-Flash');
    writer.ensureModel('lower-only', null);
    writer.ensureModel(UNKNOWN_MODEL, null);

    expect(
      rows<{ model: string; model_name: string | null; display_name: string }>(
        db,
        'SELECT model, model_name, display_name FROM models ORDER BY model',
      ),
    ).toEqual([
      { model: 'deepseek-v4.1-flash', model_name: 'DeepSeek-V4.1-Flash', display_name: 'DeepSeek-V4.1-Flash' },
      { model: 'lower-only', model_name: null, display_name: 'lower-only' },
      { model: UNKNOWN_MODEL, model_name: null, display_name: UNKNOWN_MODEL },
    ]);
  });

  it('外部同步回滚后清空缓存，后续写入不复用已回滚的行', () => {
    const { db, writer } = setup();
    const invalid = new Map<string, SessionMeta>([
      ['bad', meta({ sessionKey: null as unknown as string, cwd: '/rollback' })],
    ]);

    expect(() => writer.syncExternalSessions(invalid)).toThrow();
    expect(rows<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM groups')).toEqual([{ n: 0 }]);

    const id = writer.ensureGroup('/rollback');
    const row = db.prepare('SELECT COUNT(*) AS n FROM groups WHERE id = ?').get(id) as {
      n: number;
    };
    expect(row.n).toBe(1);
  });

  it('来源文件按路径更新 stat，id 保持稳定', () => {
    const { db, writer } = setup();
    const file: SourceFileRef = {
      path: '/p/s1.jsonl',
      kind: 'main',
      sessionKey: 's1',
      subSessionKey: null,
      sizeBytes: 10,
      mtimeMs: 100,
    };
    const first = writer.ensureSourceFile(file, 1000);
    const second = writer.ensureSourceFile({ ...file, sizeBytes: 20, mtimeMs: 200 }, 2000);
    expect(second).toBe(first);
    expect(
      rows<{ size_bytes: number; mtime_ms: number; parsed_at: number }>(
        db,
        "SELECT size_bytes, mtime_ms, parsed_at FROM source_files WHERE path = '/p/s1.jsonl'",
      ),
    ).toEqual([{ size_bytes: 20, mtime_ms: 200, parsed_at: 2000 }]);
  });
});
