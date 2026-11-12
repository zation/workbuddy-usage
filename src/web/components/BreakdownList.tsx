import type { CSSProperties } from 'react';
import type { BreakdownRow } from '../../shared/types.ts';
import { visibleBreakdownRows } from '../display.ts';
import { formatCredit, formatPercent, formatTokens } from '../format.ts';

interface BreakdownListProps {
  title: string;
  metric: 'tokens' | 'credit';
  rows: BreakdownRow[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  onSelect?: (key: string) => void;
}

const MAX_VISIBLE_ROWS = 8;

export function BreakdownList({
  title,
  metric,
  rows,
  loading,
  error,
  emptyText,
  onSelect,
}: BreakdownListProps) {
  const sorted = [...rows].sort((left, right) =>
    metric === 'tokens' ? right.totalTokens - left.totalTokens : right.credit - left.credit,
  );
  const visible = visibleBreakdownRows(sorted, MAX_VISIBLE_ROWS);

  return (
    <div className="panel breakdown">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="panel-meta">{rows.length} 项</span>
      </div>

      {error ? <p className="panel-error">{error}</p> : null}

      {loading && rows.length === 0 ? (
        <div className="skeleton-list" aria-label="载入中">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="skeleton-line" />
          ))}
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? <p className="panel-empty">{emptyText}</p> : null}

      {rows.length > 0 ? (
        <ul
          className="breakdown-list"
          style={{ '--rows': visible.length } as CSSProperties}
        >
          {visible.map((row) => {
            const value = metric === 'tokens' ? row.totalTokens : row.credit;
            const share = metric === 'tokens' ? row.tokenShare : row.creditShare;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  className="breakdown-row"
                  onClick={() => onSelect?.(row.key)}
                  disabled={!onSelect}
                  title={row.key}
                >
                  <span className="breakdown-line">
                    <span className="breakdown-name">{row.name}</span>
                    <span className="breakdown-value">
                      {metric === 'tokens' ? formatTokens(value) : formatCredit(value)}
                    </span>
                  </span>
                  <span className="breakdown-meter">
                    <span className="breakdown-bar">
                      <span
                        className="breakdown-fill"
                        style={{ width: `${Math.min(100, share * 100)}%` }}
                      />
                    </span>
                    <span className="breakdown-share">{formatPercent(share)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
