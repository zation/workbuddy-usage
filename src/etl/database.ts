import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 数据库结构版本：改表结构、或改维表的生成规则（展示名、自动分组判定等）先递增该值，
 * 旧数据库会在下次启动时被删除重建。
 */
export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  last_refresh_at INTEGER,
  last_full_scan_at INTEGER
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_auto INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL UNIQUE,
  custom_title TEXT,
  title TEXT,
  display_name TEXT NOT NULL,
  synced_at INTEGER
);

CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL UNIQUE,
  model_name TEXT,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  session_key TEXT NOT NULL,
  sub_session_key TEXT,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  parsed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  group_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  model_id INTEGER NOT NULL,
  source_file_id INTEGER NOT NULL,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  date_key TEXT NOT NULL,
  is_deepseek_offpeak INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  has_credit INTEGER NOT NULL DEFAULT 0,
  step_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_requests_date_key ON requests(date_key);
CREATE INDEX IF NOT EXISTS idx_requests_group_id ON requests(group_id);
CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_model_id ON requests(model_id);
CREATE INDEX IF NOT EXISTS idx_requests_source_file_id ON requests(source_file_id);
`;

export interface OpenDatabaseResult {
  db: DatabaseSync;
  rebuilt: boolean;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

function readSchemaVersion(db: DatabaseSync): number | null {
  if (!tableExists(db, 'meta')) {
    return null;
  }
  const row = db.prepare('SELECT schema_version FROM meta WHERE id = 1').get() as
    | { schema_version?: number }
    | undefined;
  return typeof row?.schema_version === 'number' ? row.schema_version : null;
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = `${databasePath}${suffix}`;
    if (existsSync(file)) {
      rmSync(file, { force: true });
    }
  }
}

export function initSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  db.prepare(
    'INSERT INTO meta (id, schema_version, last_refresh_at, last_full_scan_at) VALUES (1, ?, NULL, NULL) ON CONFLICT(id) DO NOTHING',
  ).run(SCHEMA_VERSION);
}

/**
 * 打开数据库；结构版本不符或文件损坏时删除重建，不写迁移脚本。
 * 新库会直接记录 last_full_scan_at，用于区分首次全量重建。
 */
export function openDatabase(databasePath: string): OpenDatabaseResult {
  mkdirSync(dirname(databasePath), { recursive: true });

  const existed = existsSync(databasePath);
  let rebuilt = !existed;

  if (existed) {
    let probe: DatabaseSync | null = null;
    try {
      probe = new DatabaseSync(databasePath);
      rebuilt = readSchemaVersion(probe) !== SCHEMA_VERSION;
    } catch {
      rebuilt = true;
    } finally {
      probe?.close();
    }
    if (rebuilt) {
      try {
        removeDatabaseFiles(databasePath);
      } catch (error) {
        throw new Error(
          `旧数据库结构版本不匹配且无法删除 ${databasePath}，请确认没有其它进程正在使用后重试。`,
          { cause: error },
        );
      }
    }
  }

  const db = new DatabaseSync(databasePath);
  initSchema(db);
  if (rebuilt) {
    db.prepare('UPDATE meta SET last_full_scan_at = ? WHERE id = 1').run(Date.now());
  }
  return { db, rebuilt };
}

export function closeDatabase(db: DatabaseSync): void {
  db.close();
}
