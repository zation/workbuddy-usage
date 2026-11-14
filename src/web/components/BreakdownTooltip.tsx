import type { BreakdownRow, BreakdownSegment } from '../../shared/types.ts';
import { focusOpacity } from '../display.ts';
import type { ModuleTab } from '../display.ts';
import { formatCredit, formatTokens } from '../format.ts';
import { ModelDot } from './ModelDot.tsx';

interface BreakdownTooltipProps {
  id: string;
  row: BreakdownRow;
  metric: ModuleTab;
  segments: BreakdownSegment[];
  focusedModel: string | null;
  placement: 'top' | 'bottom';
}

/** 整行浮出明细：分组名与合计在上，逐模型数额按降序在下；不接收指针事件。 */
export function BreakdownTooltip({
  id,
  row,
  metric,
  segments,
  focusedModel,
  placement,
}: BreakdownTooltipProps) {
  const total = metric === 'token' ? formatTokens(row.totalTokens) : formatCredit(row.credit);

  return (
    <div id={id} className={`breakdown-tooltip is-${placement}`} role="tooltip">
      <div className="breakdown-tooltip-head">
        <span className="breakdown-tooltip-title">{row.name}</span>
        <span className="breakdown-tooltip-total">{total}</span>
      </div>
      <p className="breakdown-tooltip-key">{row.key}</p>
      {segments.length === 0 ? (
        <p className="breakdown-tooltip-empty">无数据</p>
      ) : (
        <ul className="breakdown-tooltip-list">
          {segments.map((segment, index) => (
            <li
              key={`${segment.model}-${index}`}
              data-model={segment.model}
              style={{ opacity: focusOpacity(focusedModel, segment.model) }}
            >
              <ModelDot modelKey={segment.model} />
              <span className="breakdown-tooltip-model">{segment.modelName}</span>
              <span className="breakdown-tooltip-value">
                {metric === 'token'
                  ? formatTokens(segment.totalTokens)
                  : formatCredit(segment.credit)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
