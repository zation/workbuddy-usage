import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SessionMeta } from '../shared/types.ts';
import { externalDbPath } from './config.ts';

export interface ExternalWarnings {
  invalidCreditJson: number;
  nonNumericCredits: number;
  duplicateCredits: number;
}

export interface ExternalSnapshot {
  available: boolean;
  sessions: Map<string, SessionMeta>;
  credits: Map<string, number>;
  warnings: ExternalWarnings;
}

function emptyWarnings(): ExternalWarnings {
  return { invalidCreditJson: 0, nonNumericCredits: 0, duplicateCredits: 0 };
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface SessionRow {
  id: string;
  cwd: string | null;
  title: string | null;
  custom_title: string | null;
  model: string | null;
}

/**
 * 只读读取 workbuddy.db 的 sessions 与 session_usage。
 * 库不存在时返回 available=false 的空快照；库存在但读取失败时抛错，由刷新层中止本次刷新。
 */
export function readExternalSnapshot(workbuddyHome: string): ExternalSnapshot {
  const dbPath = externalDbPath(workbuddyHome);
  if (!existsSync(dbPath)) {
    return { available: false, sessions: new Map(), credits: new Map(), warnings: emptyWarnings() };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const warnings = emptyWarnings();
  const sessions = new Map<string, SessionMeta>();
  const credits = new Map<string, number>();
  const syncedAt = Date.now();

  try {
    const rows = db
      .prepare('SELECT id, cwd, title, custom_title, model FROM sessions')
      .all() as unknown as SessionRow[];
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id.length === 0) {
        continue;
      }
      sessions.set(row.id, {
        sessionKey: row.id,
        cwd: normalizeText(row.cwd),
        title: normalizeText(row.title),
        customTitle: normalizeText(row.custom_title),
        model: normalizeText(row.model),
        syncedAt,
      });
    }

    const usageRows = db.prepare('SELECT credit_json FROM session_usage').all() as unknown as Array<{
      credit_json: string | null;
    }>;
    for (const row of usageRows) {
      const raw = row.credit_json;
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        warnings.invalidCreditJson += 1;
        continue;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        warnings.invalidCreditJson += 1;
        continue;
      }
      for (const [requestId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          warnings.nonNumericCredits += 1;
          continue;
        }
        if (credits.has(requestId)) {
          warnings.duplicateCredits += 1;
          continue;
        }
        credits.set(requestId, value);
      }
    }
  } finally {
    db.close();
  }

  return { available: true, sessions, credits, warnings };
}
