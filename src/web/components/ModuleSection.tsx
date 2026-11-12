import type { ReactNode } from 'react';

interface ModuleSectionProps {
  id: string;
  accent: 'token' | 'credit';
  title: string;
  description: string;
  children: ReactNode;
}

export function ModuleSection({ id, accent, title, description, children }: ModuleSectionProps) {
  return (
    <section id={id} className={`module module-${accent}`} aria-labelledby={`${id}-title`}>
      <header className="module-header">
        <div>
          <div className="module-eyebrow">{accent === 'token' ? 'TOKEN' : 'CREDIT'}</div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="module-body">{children}</div>
    </section>
  );
}
