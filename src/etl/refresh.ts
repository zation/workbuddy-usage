import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { ParseWarnings, RefreshResult } from '../shared/types.ts';
import { emptyWarnings } from '../shared/types.ts';
import type { EtlConfig } from './config.ts';
import { DimensionWriter, computeModelDisplayNames } from './dimensions.ts';
import { readExternalSnapshot } from './external.ts';
import { parseSourceFile } from './parse.ts';
import { scanSourceFiles } from './scan.ts';

export interface Refresher {
  refresh(): Promise<RefreshResult>;
}

interface SourceFileRow {
  id: number;
  path: string;
  size_bytes: number;
  mtime_ms: number;
}

const WARNING_KEYS = [
  'invalidJsonLines',
  'invalidTimestampSteps',
  'tokenMismatchSteps',
  'cacheExceedsInputSteps',
  'zeroTotalSteps',
  'duplicateRequestIds',
  'unrecognizedFiles',
] as const;

const INSERT_REQUEST_SQL = `
INSERT INTO requests (
  request_id, group_id, session_id, model_id, source_file_id, is_subagent,
  started_at, ended_at, date_key,
  input_tokens, output_tokens, cache_read_tokens, total_tokens, step_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(request_id) DO UPDATE SET
  group_id = excluded.group_id,
  session_id = excluded.session_id,
  model_id = excluded.model_id,
  source_file_id = excluded.source_file_id,
  is_subagent = excluded.is_subagent,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  date_key = excluded.date_key,
  input_tokens = excluded.input_tokens,
  output_tokens = excluded.output_tokens,
  cache_read_tokens = excluded.cache_read_tokens,
  total_tokens = excluded.total_tokens,
  step_count = excluded.step_count
WHERE excluded.total_tokens > requests.total_tokens
`;

function addWarnings(target: ParseWarnings, source: ParseWarnings): void {
  for (const key of WARNING_KEYS) {
    target[key] += source[key];
  }
}

function deleteSource(db: DatabaseSync, sourceFileId: number): void {
  db.prepare('DELETE FROM requests WHERE source_file_id = ?').run(sourceFileId);
  db.prepare('DELETE FROM source_files WHERE id = ?').run(sourceFileId);
}

async function doRefresh(db: DatabaseSync, config: EtlConfig): Promise<RefreshResult> {
  const startedAt = Date.now();
  const warnings = emptyWarnings();
  const external = readExternalSnapshot(config.workbuddyHome);
  const writer = new DimensionWriter(db);
  writer.syncExternalSessions(external.sessions);

  const scan = scanSourceFiles(config.workbuddyHome);
  warnings.unrecognizedFiles += scan.unrecognizedFiles;

  const knownFiles = db
    .prepare('SELECT id, path, size_bytes, mtime_ms FROM source_files')
    .all() as unknown as SourceFileRow[];
  const knownByPath = new Map(knownFiles.map((row) => [row.path, row]));
  const scannedPaths = new Set(scan.files.map((file) => file.path));

  const vanished = knownFiles.filter((row) => !scannedPaths.has(row.path));
  if (vanished.length > 0) {
    db.exec('BEGIN');
    try {
      for (const row of vanished) {
        deleteSource(db, row.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const changedFiles = scan.files.filter((file) => {
    const previous = knownByPath.get(file.path);
    return (
      !previous ||
      previous.size_bytes !== file.sizeBytes ||
      previous.mtime_ms !== file.mtimeMs
    );
  });

  const parsed: Array<Awaited<ReturnType<typeof parseSourceFile>>> = [];
  const parsedFiles: typeof changedFiles = [];
  let failedFiles = 0;

  for (const file of changedFiles) {
    try {
      const result = await parseSourceFile(file, external.sessions);
      parsed.push(result);
      parsedFiles.push(file);
      addWarnings(warnings, result.warnings);
    } catch (error) {
      const previous = knownByPath.get(file.path);
      if (!existsSync(file.path)) {
        if (previous) {
          db.exec('BEGIN');
          try {
            deleteSource(db, previous.id);
            db.exec('COMMIT');
          } catch (cleanupError) {
            db.exec('ROLLBACK');
            throw cleanupError;
          }
        }
        continue;
      }
      failedFiles += 1;
      console.error(`解析失败，保留原扫描状态：${file.path}`, error);
    }
  }

  const displayNames = computeModelDisplayNames(parsed.flatMap((result) => result.modelNames));
  let upsertedRequests = 0;
  let writtenFiles = 0;

  for (let index = 0; index < parsedFiles.length; index += 1) {
    const file = parsedFiles[index];
    const result = parsed[index];
    if (!file || !result) {
      continue;
    }

    try {
      const resolved = result.requests.map((request) => ({
        request,
        groupId: writer.ensureGroup(request.groupPath),
        sessionId: writer.ensureSession(request.sessionKey),
        modelId: writer.ensureModel(request.modelKey, displayNames.get(request.modelKey) ?? null),
      }));

      db.exec('BEGIN');
      try {
        const sourceFileId = writer.ensureSourceFile(file, Date.now());
        db.prepare('DELETE FROM requests WHERE source_file_id = ?').run(sourceFileId);
        const insert = db.prepare(INSERT_REQUEST_SQL);
        const findExisting = db.prepare('SELECT source_file_id FROM requests WHERE request_id = ?');

        for (const { request, groupId, sessionId, modelId } of resolved) {
          const existing = findExisting.get(request.requestId) as
            | { source_file_id?: number }
            | undefined;
          if (
            existing &&
            typeof existing.source_file_id === 'number' &&
            existing.source_file_id !== sourceFileId
          ) {
            warnings.duplicateRequestIds += 1;
          }

          const outcome = insert.run(
            request.requestId,
            groupId,
            sessionId,
            modelId,
            sourceFileId,
            request.isSubagent ? 1 : 0,
            request.startedAt,
            request.endedAt,
            request.dateKey,
            request.inputTokens,
            request.outputTokens,
            request.cacheReadTokens,
            request.totalTokens,
            request.stepCount,
          );
          upsertedRequests += Number(outcome.changes);
        }
        db.exec('COMMIT');
        writtenFiles += 1;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      failedFiles += 1;
      console.error(`写入失败，保留原扫描状态：${file.path}`, error);
    }
  }

  const finishedAt = Date.now();
  db.prepare('UPDATE meta SET last_refresh_at = ? WHERE id = 1').run(finishedAt);
  const meta = db.prepare('SELECT last_refresh_at FROM meta WHERE id = 1').get() as
    | { last_refresh_at?: number | null }
    | undefined;

  return {
    skipped: false,
    scannedFiles: scan.files.length,
    changedFiles: writtenFiles,
    upsertedRequests,
    creditAttached: 0,
    failedFiles,
    durationMs: finishedAt - startedAt,
    lastRefreshAt: typeof meta?.last_refresh_at === 'number' ? meta.last_refresh_at : null,
    warnings,
  };
}

/**
 * 刷新入口：进程内互斥锁覆盖扫描、解析、写入与元信息更新全过程。
 * 并发调用等待当前刷新结束并标记 skipped，不会重复执行。
 */
export function createRefresher(db: DatabaseSync, config: EtlConfig): Refresher {
  let inFlight: Promise<RefreshResult> | null = null;

  return {
    async refresh(): Promise<RefreshResult> {
      if (inFlight) {
        const joined = await inFlight;
        return { ...joined, skipped: true };
      }
      const run = doRefresh(db, config);
      inFlight = run;
      try {
        return await run;
      } finally {
        if (inFlight === run) {
          inFlight = null;
        }
      }
    },
  };
}
