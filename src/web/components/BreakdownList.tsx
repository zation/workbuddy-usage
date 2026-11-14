import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { BreakdownRow } from '../../shared/types.ts';
import { focusOpacity, hitZoneWidths, segmentWidths, visibleBreakdownRows, visibleSegments } from '../display.ts';
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
/** 段级命中区的最小宽度（像素）：视觉段宽不变，只把过窄的段扩展成可稳定 hover 的区域。 */
const MIN_HIT_WIDTH_PX = 8;

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
  const [focusedModel, setFocusedModel] = useState<string | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [barWidth, setBarWidth] = useState(0);
  const barRef = useRef<HTMLSpanElement | null>(null);
  const tooltipId = useId();

  const sorted = [...rows].sort((left, right) =>
    metric === 'tokens' ? right.totalTokens - left.totalTokens : right.credit - left.credit,
  );
  const visible = visibleBreakdownRows(sorted, MAX_VISIBLE_ROWS);

  // 命中区宽度用百分比表达，需要知道数值条的实际像素宽度
  useEffect(() => {
    const node = barRef.current;
    if (!stackByModel || !node) {
      return;
    }
    const update = () => setBarWidth(node.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [stackByModel, visible.length]);

  // 换筛选、换 tab 的数据后不把上一个模型残留到新的模型集合上
  useEffect(() => {
    setFocusedModel(null);
  }, [rows, metric]);

  const activate = (key: string, element: HTMLElement) => {
    setActiveKey(key);
    setPlacement(
      element.getBoundingClientRect().top < TOOLTIP_FLIP_THRESHOLD ? 'bottom' : 'top',
    );
  };

  const deactivate = () => {
    setActiveKey(null);
    setFocusedModel(null);
  };

  const handleZoneOver = (event: ReactMouseEvent<HTMLElement>) => {
    const zone = (event.target as HTMLElement).closest('.breakdown-hit-zone');
    const model = zone instanceof HTMLElement ? zone.dataset.model : undefined;
    if (model) {
      setFocusedModel(model);
    }
  };

  const handleZoneOut = (event: ReactMouseEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof HTMLElement && next.closest('.breakdown-hit-zone')) {
      return;
    }
    setFocusedModel(null);
  };

  const minHitPercent = barWidth > 0 ? (MIN_HIT_WIDTH_PX / barWidth) * 100 : 0;

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
          {visible.map((row, rowIndex) => {
            const value = metric === 'tokens' ? row.totalTokens : row.credit;
            const share = metric === 'tokens' ? row.tokenShare : row.creditShare;
            const segments = stackByModel
              ? visibleSegments(row, metricKey, visibleModels ?? new Set())
              : [];
            const widths = segmentWidths(share, value, segments, metricKey);
            const hitWidths = minHitPercent > 0 ? hitZoneWidths(widths, minHitPercent) : widths;
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
                    <span className="breakdown-bar" ref={rowIndex === 0 ? barRef : undefined}>
                      {widths.length > 0 ? (
                        <>
                          <span className="breakdown-segments">
                            {segments.map((segment, index) => (
                              <span
                                key={`${segment.model}-${index}`}
                                className="breakdown-segment"
                                data-model={segment.model}
                                style={{
                                  width: `${widths[index] ?? 0}%`,
                                  backgroundColor: modelColor(segment.model),
                                  opacity: focusOpacity(focusedModel, segment.model),
                                }}
                              />
                            ))}
                          </span>
                          <span
                            className="breakdown-hit-layer"
                            onMouseOver={handleZoneOver}
                            onMouseOut={handleZoneOut}
                          >
                            {segments.map((segment, index) => (
                              <span
                                key={`hit-${segment.model}-${index}`}
                                className="breakdown-hit-zone"
                                data-model={segment.model}
                                style={{ width: `${hitWidths[index] ?? 0}%` }}
                              />
                            ))}
                          </span>
                        </>
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
                    focusedModel={focusedModel}
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
