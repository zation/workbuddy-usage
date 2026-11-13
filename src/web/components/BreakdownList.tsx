import { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BreakdownRow } from '../../shared/types.ts';
import { segmentWidths, visibleBreakdownRows, visibleSegments } from '../display.ts';
import type { ModuleTab } from '../display.ts';
import { formatCredit, formatPercent, formatTokens } from '../format.ts';
import { modelColor } from '../model-colors.ts';
import { BreakdownTooltip } from './BreakdownTooltip.tsx';
import { ModelDot } from './ModelDot.tsx';

interface BreakdownListProps {
  title: string;
  metric: 'tokens' | 'credit';
  rows: BreakdownRow[];
  loading: boolean;
  error: string | null;
  emptyText: string;
  onSelect?: (key: string) => void;
  showModelDot?: boolean;
  /** 仅「按分组」开启：数值条按模型分段并浮出明细提示。 */
  stackByModel?: boolean;
  /** 当前 tab 可见的模型集合，用于分段与提示的 0 值隐藏判定。 */
  visibleModels?: Set<string>;
}

const MAX_VISIBLE_ROWS = 8;
const TOOLTIP_FLIP_THRESHOLD = 220;

export function BreakdownList({
  title,
  metric,
  rows,
  loading,
  error,
  emptyText,
  onSelect,
  showModelDot,
  stackByModel = false,
  visibleModels,
}: BreakdownListProps) {
  const metricKey: ModuleTab = metric === 'tokens' ? 'token' : 'credit';
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const tooltipId = useId();

  const sorted = [...rows].sort((left, right) =>
    metric === 'tokens' ? right.totalTokens - left.totalTokens : right.credit - left.credit,
  );
  const visible = visibleBreakdownRows(sorted, MAX_VISIBLE_ROWS);

  const activate = (key: string, element: HTMLElement) => {
    setActiveKey(key);
    setPlacement(
      element.getBoundingClientRect().top < TOOLTIP_FLIP_THRESHOLD ? 'bottom' : 'top',
    );
  };

  const deactivate = () => setActiveKey(null);

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
            const segments = stackByModel
              ? visibleSegments(row, metricKey, visibleModels ?? new Set())
              : [];
            const widths = segmentWidths(share, value, segments, metricKey);
            const active = stackByModel && activeKey === row.key;

            return (
              <li key={row.key}>
                <button
                  type="button"
                  className="breakdown-row"
                  onClick={() => onSelect?.(row.key)}
                  disabled={!onSelect}
                  title={stackByModel ? undefined : row.key}
                  aria-describedby={active ? tooltipId : undefined}
                  onMouseEnter={
                    stackByModel
                      ? (event) => activate(row.key, event.currentTarget)
                      : undefined
                  }
                  onMouseLeave={stackByModel ? deactivate : undefined}
                  onFocus={
                    stackByModel
                      ? (event) => activate(row.key, event.currentTarget)
                      : undefined
                  }
                  onBlur={stackByModel ? deactivate : undefined}
                >
                  <span className="breakdown-line">
                    <span className="breakdown-name">
                      {showModelDot ? <ModelDot modelKey={row.key} /> : null}
                      {row.name}
                    </span>
                    <span className="breakdown-value">
                      {metric === 'tokens' ? formatTokens(value) : formatCredit(value)}
                    </span>
                  </span>
                  <span className="breakdown-meter">
                    <span className="breakdown-bar">
                      {widths.length > 0 ? (
                        <span className="breakdown-segments">
                          {segments.map((segment, index) => (
                            <span
                              key={`${segment.model}-${index}`}
                              className="breakdown-segment"
                              style={{
                                width: `${widths[index] ?? 0}%`,
                                backgroundColor: modelColor(segment.model),
                              }}
                            />
                          ))}
                        </span>
                      ) : (
                        <span
                          className="breakdown-fill"
                          style={{ width: `${Math.min(100, share * 100)}%` }}
                        />
                      )}
                    </span>
                    <span className="breakdown-share">{formatPercent(share)}</span>
                  </span>
                </button>
                {active ? (
                  <BreakdownTooltip
                    id={tooltipId}
                    row={row}
                    metric={metricKey}
                    segments={segments}
                    placement={placement}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
