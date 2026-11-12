import type { KeyboardEvent } from 'react';
import type { ModuleTab } from '../display.ts';

interface ModuleTabsProps {
  activeTab: ModuleTab;
  onChange: (tab: ModuleTab) => void;
}

const TABS: Array<{ key: ModuleTab; label: string }> = [
  { key: 'token', label: 'Token 用量' },
  { key: 'credit', label: '积分消耗' },
];

/** tab 与其面板的 DOM id 只在这里定义一处，面板侧复用同一对函数。 */
export function moduleTabId(tab: ModuleTab): string {
  return `${tab}-tab`;
}

export function modulePanelId(tab: ModuleTab): string {
  return `${tab}-module`;
}

/** 两个模块共用一组筛选，tab 只切换渲染哪个模块，不重置任何筛选与表格状态。 */
export function ModuleTabs({ activeTab, onChange }: ModuleTabsProps) {
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.key === activeTab);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (next) {
      onChange(next.key);
      document.getElementById(moduleTabId(next.key))?.focus();
    }
  };

  return (
    <div className="module-tabs" role="tablist" aria-label="模块切换">
      {TABS.map((tab) => {
        const selected = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={moduleTabId(tab.key)}
            data-tab={tab.key}
            className={`module-tab${selected ? ' is-active' : ''}`}
            aria-selected={selected}
            aria-controls={modulePanelId(tab.key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={move}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
