import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { UNKNOWN_GROUP, UNKNOWN_MODEL } from '../shared/constants.ts';
import type { ModelNameCandidate, SessionMeta, SourceFileRef } from '../shared/types.ts';

const UPPERCASE_LETTER = /[A-Z]/;

/** 取路径末段；同时兼容 POSIX 与 Windows 分隔符。 */
export function lastPathSegment(value: string): string {
  const trimmed = value.replace(/[\\/]+$/u, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const segment = index >= 0 ? trimmed.slice(index + 1) : trimmed;
  return segment.length > 0 ? segment : value;
}

/** R6：自定义标题 → 自动标题 → 会话 ID 前 8 位。 */
export function sessionDisplayName(meta: {
  sessionKey: string;
  customTitle: string | null;
  title: string | null;
}): string {
  return meta.customTitle ?? meta.title ?? meta.sessionKey.slice(0, 8);
}

/**
 * C12：同一模型标识的展示名取「含大写且不等于标识本身」的候选中出现次数最多者，
 * 并列取字典序最小；没有候选则回退标识本身。结果只取决于候选集合。
 */
export function computeModelDisplayNames(
  candidates: ModelNameCandidate[],
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();

  for (const candidate of candidates) {
    const { modelKey, name } = candidate;
    if (!modelKey || modelKey === UNKNOWN_MODEL) {
      continue;
    }
    if (!name || name === modelKey || !UPPERCASE_LETTER.test(name)) {
      continue;
    }
    let names = counts.get(modelKey);
    if (!names) {
      names = new Map();
      counts.set(modelKey, names);
    }
    names.set(name, (names.get(name) ?? 0) + 1);
  }

  const displayNames = new Map<string, string>();
  for (const [modelKey, names] of counts) {
    let bestName: string | null = null;
    let bestCount = -1;
    for (const [name, count] of names) {
      if (count > bestCount || (count === bestCount && (bestName === null || name < bestName))) {
        bestName = name;
        bestCount = count;
      }
    }
    if (bestName) {
      displayNames.set(modelKey, bestName);
    }
  }
  return displayNames;
}

/**
 * 维表写入器：按业务键 upsert 并缓存内部 id，一次刷新内复用。
 * 所有维表都是快照，外部行消失时不删除本项目的行（C11）。
 */
export class DimensionWriter {
  private readonly db: DatabaseSync;
  private readonly groupIds = new Map<string, number>();
  private readonly sessionIds = new Map<string, number>();
  private readonly modelIds = new Map<string, number>();

  private readonly insertGroup: StatementSync;
  private readonly selectGroup: StatementSync;
  private readonly insertSessionFallback: StatementSync;
  private readonly upsertSession: StatementSync;
  private readonly selectSession: StatementSync;
  private readonly upsertModel: StatementSync;
  private readonly selectModel: StatementSync;
  private readonly upsertSourceFile: StatementSync;
  private readonly selectSourceFile: StatementSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.insertGroup = db.prepare(
      'INSERT INTO groups (group_path, display_name) VALUES (?, ?) ON CONFLICT(group_path) DO NOTHING',
    );
    this.selectGroup = db.prepare('SELECT id FROM groups WHERE group_path = ?');
    this.insertSessionFallback = db.prepare(
      'INSERT INTO sessions (session_key, custom_title, title, display_name, synced_at) VALUES (?, NULL, NULL, ?, NULL) ON CONFLICT(session_key) DO NOTHING',
    );
    this.upsertSession = db.prepare(
      `INSERT INTO sessions (session_key, custom_title, title, display_name, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET
         custom_title = excluded.custom_title,
         title = excluded.title,
         display_name = excluded.display_name,
         synced_at = excluded.synced_at`,
    );
    this.selectSession = db.prepare('SELECT id FROM sessions WHERE session_key = ?');
    this.upsertModel = db.prepare(
      `INSERT INTO models (model, model_name, display_name) VALUES (?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET
         model_name = CASE
           WHEN models.display_name = models.model AND excluded.model_name IS NOT NULL
           THEN excluded.model_name ELSE models.model_name END,
         display_name = CASE
           WHEN models.display_name = models.model AND excluded.model_name IS NOT NULL
           THEN excluded.display_name ELSE models.display_name END`,
    );
    this.selectModel = db.prepare('SELECT id FROM models WHERE model = ?');
    this.upsertSourceFile = db.prepare(
      `INSERT INTO source_files (path, kind, session_key, sub_session_key, size_bytes, mtime_ms, parsed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         kind = excluded.kind,
         session_key = excluded.session_key,
         sub_session_key = excluded.sub_session_key,
         size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms,
         parsed_at = excluded.parsed_at`,
    );
    this.selectSourceFile = db.prepare('SELECT id FROM source_files WHERE path = ?');
  }

  ensureGroup(groupPath: string | null): number {
    const key = groupPath ?? UNKNOWN_GROUP;
    const cached = this.groupIds.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const displayName = key === UNKNOWN_GROUP ? UNKNOWN_GROUP : lastPathSegment(key);
    this.insertGroup.run(key, displayName);
    const row = this.selectGroup.get(key) as { id?: number } | undefined;
    if (typeof row?.id !== 'number') {
      throw new Error(`无法写入分组维表：${key}`);
    }
    this.groupIds.set(key, row.id);
    return row.id;
  }

  /** 请求侧会话：外部行不存在时也要建行，展示名回退会话 ID 前 8 位。 */
  ensureSession(sessionKey: string): number {
    const cached = this.sessionIds.get(sessionKey);
    if (cached !== undefined) {
      return cached;
    }
    this.insertSessionFallback.run(sessionKey, sessionKey.slice(0, 8));
    const row = this.selectSession.get(sessionKey) as { id?: number } | undefined;
    if (typeof row?.id !== 'number') {
      throw new Error(`无法写入会话维表：${sessionKey}`);
    }
    this.sessionIds.set(sessionKey, row.id);
    return row.id;
  }

  /** 同步外部 sessions：更新仍存在的行，不删除已消失的行（C11）。 */
  syncExternalSessions(sessions: Map<string, SessionMeta>): void {
    this.db.exec('BEGIN');
    try {
      for (const meta of sessions.values()) {
        if (meta.cwd) {
          this.ensureGroup(meta.cwd);
        }
        this.upsertSession.run(
          meta.sessionKey,
          meta.customTitle,
          meta.title,
          sessionDisplayName(meta),
          meta.syncedAt,
        );
        const row = this.selectSession.get(meta.sessionKey) as { id?: number } | undefined;
        if (typeof row?.id !== 'number') {
          throw new Error(`无法写入会话维表：${meta.sessionKey}`);
        }
        this.sessionIds.set(meta.sessionKey, row.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 模型维表：preferredName 由本次刷新的全局候选算出；已规范化的展示名不再被覆盖，
   * 只在当前仍是原始标识时升级，避免增量刷新把展示名改回次优写法。
   */
  ensureModel(modelKey: string, preferredName: string | null): number {
    const cached = this.modelIds.get(modelKey);
    if (cached !== undefined) {
      return cached;
    }
    const normalized =
      preferredName && preferredName !== modelKey ? preferredName : null;
    const displayName = modelKey === UNKNOWN_MODEL ? UNKNOWN_MODEL : (normalized ?? modelKey);
    this.upsertModel.run(modelKey, normalized, displayName);
    const row = this.selectModel.get(modelKey) as { id?: number } | undefined;
    if (typeof row?.id !== 'number') {
      throw new Error(`无法写入模型维表：${modelKey}`);
    }
    this.modelIds.set(modelKey, row.id);
    return row.id;
  }

  /** 来源文件状态必须与请求行同事务写入（C9 / C10）。 */
  ensureSourceFile(file: SourceFileRef, parsedAt: number): number {
    this.upsertSourceFile.run(
      file.path,
      file.kind,
      file.sessionKey,
      file.subSessionKey,
      file.sizeBytes,
      file.mtimeMs,
      parsedAt,
    );
    const row = this.selectSourceFile.get(file.path) as { id?: number } | undefined;
    if (typeof row?.id !== 'number') {
      throw new Error(`无法写入来源文件：${file.path}`);
    }
    return row.id;
  }
}
