import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface FixtureSession {
  id: string;
  cwd?: string | null;
  title?: string | null;
  customTitle?: string | null;
  model?: string | null;
  deletedAt?: number | null;
}

export interface FixtureUsage {
  sessionId: string;
  creditJson: string | null;
}

/** 建立与真实库兼容的最小 sessions / session_usage 夹具，只含本项目读取的列。 */
export function createWorkbuddyDb(
  workbuddyHome: string,
  sessions: FixtureSession[],
  usage: FixtureUsage[],
): string {
  const dbPath = join(workbuddyHome, 'workbuddy.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      title TEXT,
      custom_title TEXT,
      model TEXT,
      deleted_at INTEGER
    );
    CREATE TABLE session_usage (
      session_id TEXT PRIMARY KEY,
      used INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      credit_json TEXT
    );
  `);

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, cwd, title, custom_title, model, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const session of sessions) {
    insertSession.run(
      session.id,
      session.cwd ?? null,
      session.title ?? null,
      session.customTitle ?? null,
      session.model ?? null,
      session.deletedAt ?? null,
    );
  }

  const insertUsage = db.prepare(
    'INSERT INTO session_usage (session_id, credit_json) VALUES (?, ?)',
  );
  for (const row of usage) {
    insertUsage.run(row.sessionId, row.creditJson);
  }

  db.close();
  return dbPath;
}
