import type { DatabaseSync } from 'node:sqlite';

/**
 * 积分独立挂接（AD-7 / C6）：只更新当前映射中存在的请求；
 * 映射外不触碰、不主动清零；值未变化的行不计入补挂条数。
 */
export function attachCredits(db: DatabaseSync, credits: Map<string, number>): number {
  if (credits.size === 0) {
    return 0;
  }

  const update = db.prepare(
    `UPDATE requests SET credit = ?, has_credit = 1
     WHERE request_id = ? AND (credit <> ? OR has_credit <> 1)`,
  );

  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const [requestId, credit] of credits) {
      const outcome = update.run(credit, requestId, credit);
      changed += Number(outcome.changes);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return changed;
}
