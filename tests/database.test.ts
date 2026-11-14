import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, closeDatabase, openDatabase } from '../src/etl/database.ts';
import { DimensionWriter } from '../src/etl/dimensions.ts';

const tempDirs: string[] = [];

function makeDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wb-usage-index-'));
  tempDirs.push(dir);
  return join(dir, '.data', 'database.db');
}

function columnNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function indexNames(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

interface GroupRow {
  group_path: string;
  display_name: string;
  is_auto: number;
}

function groupRows(db: DatabaseSync): GroupRow[] {
  return db
    .prepare('SELECT group_path, display_name, is_auto FROM groups ORDER BY group_path')
    .all() as unknown as GroupRow[];
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('数据库 schema', () => {
  it('首次打开创建六张表、索引与 meta 单行', () => {
    const databasePath = makeDatabasePath();
    const { db, rebuilt } = openDatabase(databasePath);

    expect(rebuilt).toBe(true);
    expect(existsSync(databasePath)).toBe(true);

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables.sort()).toEqual(['groups', 'meta', 'models', 'requests', 'sessions', 'source_files']);

    expect(columnNames(db, 'requests')).toEqual([
      'id',
      'request_id',
      'group_id',
      'session_id',
      'model_id',
      'source_file_id',
      'is_subagent',
      'started_at',
      'ended_at',
      'date_key',
      'is_deepseek_offpeak',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'total_tokens',
      'credit',
      'has_credit',
      'step_count',
    ]);
    expect(columnNames(db, 'groups')).toEqual(['id', 'group_path', 'display_name', 'is_auto']);
    expect(columnNames(db, 'meta')).toEqual([
      'id',
      'schema_version',
      'last_refresh_at',
      'last_full_scan_at',
    ]);

    const requestIndexes = indexNames(db, 'requests');
    for (const expected of [
      'idx_requests_date_key',
      'idx_requests_group_id',
      'idx_requests_session_id',
      'idx_requests_model_id',
      'idx_requests_source_file_id',
    ]) {
      expect(requestIndexes).toContain(expected);
    }

    const meta = db.prepare('SELECT * FROM meta').all() as Array<{
      id: number;
      schema_version: number;
      last_full_scan_at: number | null;
    }>;
    expect(meta).toHaveLength(1);
    expect(meta[0]?.schema_version).toBe(SCHEMA_VERSION);
    expect(typeof meta[0]?.last_full_scan_at).toBe('number');

    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(journal.journal_mode).toBe('delete');

    closeDatabase(db);
  });

  it('业务键唯一约束与 meta 单行约束生效', () => {
    const { db } = openDatabase(makeDatabasePath());
    db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/a', 'a');
    expect(() =>
      db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/a', 'a'),
    ).toThrow();

    expect(() =>
      db
        .prepare('INSERT INTO meta (id, schema_version) VALUES (2, ?)')
        .run(SCHEMA_VERSION),
    ).toThrow();

    closeDatabase(db);
  });

  it('schema_version 不匹配时删除重建并重新分配内部 id', () => {
    const databasePath = makeDatabasePath();
    const first = openDatabase(databasePath);
    first.db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/a', 'a');
    first.db.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(SCHEMA_VERSION - 1);
    closeDatabase(first.db);

    const second = openDatabase(databasePath);
    expect(second.rebuilt).toBe(true);

    const meta = second.db.prepare('SELECT schema_version FROM meta WHERE id = 1').get() as {
      schema_version: number;
    };
    expect(meta.schema_version).toBe(SCHEMA_VERSION);
    expect(second.db.prepare('SELECT COUNT(*) AS n FROM groups').get()).toEqual({ n: 0 });

    second.db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/b', 'b');
    const row = second.db.prepare('SELECT id FROM groups WHERE group_path = ?').get('/b') as {
      id: number;
    };
    expect(row.id).toBe(1);

    closeDatabase(second.db);
  });

  it('结构版本一致时保留已有数据', () => {
    const databasePath = makeDatabasePath();
    const first = openDatabase(databasePath);
    first.db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/a', 'a');
    closeDatabase(first.db);

    const second = openDatabase(databasePath);
    expect(second.rebuilt).toBe(false);
    expect(second.db.prepare('SELECT COUNT(*) AS n FROM groups').get()).toEqual({ n: 1 });
    closeDatabase(second.db);
  });

  it('groups.is_auto 默认 0', () => {
    const { db } = openDatabase(makeDatabasePath());
    db.prepare('INSERT INTO groups (group_path, display_name) VALUES (?, ?)').run('/a', 'a');
    expect(groupRows(db)).toEqual([{ group_path: '/a', display_name: 'a', is_auto: 0 }]);
    closeDatabase(db);
  });

  it('连续两次全量重建的 groups 行集合一致且与写入顺序无关', () => {
    const databasePath = makeDatabasePath();
    const paths = [
      '/work/beta',
      '/Users/x/WorkBuddy/2026-10-17-21-46-27',
      '/work/alpha',
      'C:\\Users\\x\\WorkBuddy\\2026-10-18-09-00-00',
    ];

    const first = openDatabase(databasePath);
    const firstWriter = new DimensionWriter(first.db);
    for (const path of paths) {
      firstWriter.ensureGroup(path);
    }
    const firstRows = groupRows(first.db);
    first.db.prepare('UPDATE meta SET schema_version = ? WHERE id = 1').run(SCHEMA_VERSION - 1);
    closeDatabase(first.db);

    const second = openDatabase(databasePath);
    expect(second.rebuilt).toBe(true);
    const secondWriter = new DimensionWriter(second.db);
    for (const path of [...paths].reverse()) {
      secondWriter.ensureGroup(path);
    }
    expect(groupRows(second.db)).toEqual(firstRows);

    expect(
      Object.fromEntries(firstRows.map((row) => [row.group_path, row.is_auto])),
    ).toEqual({
      '/work/beta': 0,
      '/Users/x/WorkBuddy/2026-10-17-21-46-27': 1,
      '/work/alpha': 0,
      'C:\\Users\\x\\WorkBuddy\\2026-10-18-09-00-00': 1,
    });
    closeDatabase(second.db);
  });
});
