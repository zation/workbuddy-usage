import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface SelectOption {
  key: string;
  name: string;
}

interface SelectProps {
  /** 触发按钮的 id，供外部 label 关联。 */
  id?: string;
  /** 追加在容器 `.select` 上；紧凑宽度用 `.select-compact`。 */
  className?: string;
  label: string;
  /** 第一项由调用方提供空值文案（key 为空串表示不筛选）。 */
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** 仅模型维度传入色点，其余维度不渲染图标。 */
  renderLeading?: (key: string) => ReactNode;
}

/** 通用下拉：button + listbox，键盘与 ARIA 行为沿用原模型下拉，不处理 Tab。 */
export function Select({
  id,
  className,
  label,
  options,
  value,
  onChange,
  renderLeading,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const items = useMemo<SelectOption[]>(() => {
    if (value && !options.some((item) => item.key === value)) {
      const withCurrent = [...options];
      withCurrent.splice(1, 0, { key: value, name: value });
      return withCurrent;
    }
    return options;
  }, [options, value]);

  const selectedIndex = Math.max(0, items.findIndex((item) => item.key === value));
  const selected = items[selectedIndex] ?? { key: '', name: '' };

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const selectAt = (index: number) => {
    const item = items[index];
    if (!item) {
      return;
    }
    onChange(item.key);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (!open) {
      setOpen(true);
      setActiveIndex(selectedIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      selectAt(activeIndex);
      return;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((previous) => (previous + delta + items.length) % items.length);
  };

  return (
    <div className={className ? `select ${className}` : 'select'} ref={containerRef}>
      <button
        type="button"
        id={id}
        className="select-trigger"
        data-value={value}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => {
          setOpen((previous) => !previous);
          setActiveIndex(selectedIndex);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="select-value">
          {selected.key && renderLeading ? renderLeading(selected.key) : null}
          {selected.name}
        </span>
        <span className="select-chevron" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </span>
      </button>
      <ul
        id={listboxId}
        role="listbox"
        aria-label={label}
        className="select-list"
        hidden={!open}
      >
        {items.map((item, index) => (
          <li
            key={item.key}
            id={`${listboxId}-${index}`}
            data-value={item.key}
            role="option"
            aria-selected={item.key === value}
            className={`select-option${index === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectAt(index)}
          >
            {item.key ? (
              renderLeading?.(item.key)
            ) : renderLeading ? (
              <span className="model-dot is-empty" aria-hidden="true" />
            ) : null}
            <span className="select-option-name">{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
