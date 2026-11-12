export interface MetricItem {
  label: string;
  value: string;
  hint?: string;
  suffix?: string;
  emphasis?: boolean;
}

interface MetricCardsProps {
  items: MetricItem[];
}

export function MetricCards({ items }: MetricCardsProps) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <div
          key={item.label}
          className={`metric-card${item.emphasis ? ' metric-card-emphasis' : ''}`}
        >
          <span className="metric-label">{item.label}</span>
          <strong className="metric-value">
            {item.value}
            {item.suffix ? <span className="metric-suffix">{item.suffix}</span> : null}
          </strong>
          {item.hint ? <span className="metric-hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
