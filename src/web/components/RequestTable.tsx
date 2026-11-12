import type { RequestRow, RequestSortField, SortOrder } from '../../shared/types.ts';
import { formatCredit, formatDateTime, formatInteger } from '../format.ts';

export interface SortState {
  field: RequestSortField;
  order: SortOrder;
}

interface RequestTableProps {
  title: string;
  rows: RequestRow[];
  loading: boolean;
  error: string | null;
  sort: SortState;
  onSort: (field: RequestSortField, order: SortOrder) => void;
  emptyText: string;
}

interface NumericColumn {
  field: RequestSortField;
  label: string;
  value: (row: RequestRow) => number;
}

const NUMERIC_COLUMNS: NumericColumn[] = [
  { field: 'inputTokens', label: '输入', value: (row) => row.inputTokens },
  { field: 'outputTokens', label: '输出', value: (row) => row.outputTokens },
  { field: 'cacheReadTokens', label: '缓存', value: (row) => row.cacheReadTokens },
  { field: 'totalTokens', label: '合计', value: (row) => row.totalTokens },
  { field: 'credit', label: '积分', value: (row) => row.credit },
];

export function RequestTable({
  title,
  rows,
  loading,
  error,
  sort,
  onSort,
  emptyText,
}: RequestTableProps) {
  const toggle = (field: RequestSortField) => {
    const order: SortOrder = sort.field === field && sort.order === 'desc' ? 'asc' : 'desc';
    onSort(field, order);
  };

  const sortIndicator = (field: RequestSortField) => {
    if (sort.field !== field) {
      return '↕';
    }
    return sort.order === 'desc' ? '↓' : '↑';
  };

  const ariaSort = (field: RequestSortField): 'ascending' | 'descending' | 'none' => {
    if (sort.field !== field) {
      return 'none';
    }
    return sort.order === 'desc' ? 'descending' : 'ascending';
  };

  return (
    <div className="panel table-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="panel-meta">{rows.length} 条</span>
      </div>

      {error ? <p className="panel-error">{error}</p> : null}
      {!error && !loading && rows.length === 0 ? <p className="panel-empty">{emptyText}</p> : null}

      {rows.length > 0 ? (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          <table>
            <thead>
              <tr>
                <th aria-sort={ariaSort('startedAt')}>
                  <button type="button" className="sort-button" onClick={() => toggle('startedAt')}>
                    时间<span className="sort-indicator">{sortIndicator('startedAt')}</span>
                  </button>
                </th>
                <th>分组</th>
                <th>会话标题</th>
                <th>模型</th>
                {NUMERIC_COLUMNS.map((column) => (
                  <th key={column.field} className="numeric" aria-sort={ariaSort(column.field)}>
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => toggle(column.field)}
                    >
                      {column.label}
                      <span className="sort-indicator">{sortIndicator(column.field)}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.requestId}>
                  <td className="nowrap">{formatDateTime(row.startedAt)}</td>
                  <td className="truncate" title={row.group}>
                    {row.groupName}
                  </td>
                  <td className="truncate" title={row.session}>
                    <span className="session-name">{row.sessionName}</span>
                    {row.isSubagent ? <span className="badge-subagent">子代理</span> : null}
                  </td>
                  <td className="truncate" title={row.model}>
                    {row.modelName}
                  </td>
                  {NUMERIC_COLUMNS.map((column) => (
                    <td key={column.field} className="numeric">
                      {column.field === 'credit' ? (
                        row.hasCredit ? (
                          formatCredit(row.credit)
                        ) : (
                          <span className="cell-muted">无记录</span>
                        )
                      ) : (
                        formatInteger(column.value(row))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
