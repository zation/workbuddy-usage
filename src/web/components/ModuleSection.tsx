import type { ReactNode } from 'react';

interface ModuleSectionProps {
  accent: 'token' | 'credit';
  title: string;
  description: string;
  children: ReactNode;
}

export function ModuleSection({ accent, title, description, children }: ModuleSectionProps) {
  return (
    <section className={`module module-${accent}`}>
      <header className="module-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="module-body">{children}</div>
    </section>
  );
}
