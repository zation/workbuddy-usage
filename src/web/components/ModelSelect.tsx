import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BreakdownRow } from '../../shared/types.ts';
import { ModelDot } from './ModelDot.tsx';

interface ModelSelectProps {
  rows: BreakdownRow[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

interface ModelOption {
  key: string;
  name: string;
}

export function ModelSelect({ rows, value, onChange }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const options = useMemo<ModelOption[]>(() => {
    const items: ModelOption[] = [
      { key: '', name: '全部模型' },
      ...rows.map((row) => ({ key: row.key, name: row.name })),
    ];
    if (value && !rows.some((row) => row.key === value)) {
      items.splice(1, 0, { key: value, name: value });
    }
    return items;
  }, [rows, value]);

  const selectedIndex = Math.max(0, options.findIndex((item) => item.key === (value ?? '')));
  const selected = options[selectedIndex];

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
    const item = options[index];
    if (!item) {
      return;
    }
    onChange(item.key || undefined);
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
    setActiveIndex((previous) => (previous + delta + options.length) % options.length);
  };

  return (
    <div className="model-select" ref={containerRef}>
      <button
        type="button"
        id="filter-model"
        className="model-select-trigger"
        data-model={value ?? ''}
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
        <span className="model-select-value">
          {selected.key ? <ModelDot modelKey={selected.key} /> : null}
          {selected.name}
        </span>
        <span className="model-select-chevron" aria-hidden="true">▾</span>
      </button>
      <ul
        id={listboxId}
        role="listbox"
        aria-label="模型"
        className="model-select-list"
        hidden={!open}
      >
        {options.map((item, index) => (
          <li
            key={item.key}
            id={`${listboxId}-${index}`}
            data-model={item.key}
            role="option"
            aria-selected={item.key === (value ?? '')}
            className={`model-select-option${index === activeIndex ? ' is-active' : ''}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => selectAt(index)}
          >
            {item.key ? (
              <ModelDot modelKey={item.key} />
            ) : (
              <span className="model-dot is-empty" aria-hidden="true" />
            )}
            <span className="model-select-option-name">{item.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
