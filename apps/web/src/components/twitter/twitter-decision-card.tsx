import type { ReactNode } from "react";

type TwitterDecisionCardProps = {
  variant: "review" | "main" | "publish";
  eyebrow: string;
  title: string;
  badge?: string | null;
  summary?: string | null;
  facts?: Array<{
    label: string;
    value: string;
  }>;
  sections?: Array<{
    label: string;
    items: string[];
    emptyText?: string;
  }>;
  footer?: ReactNode;
};

export function TwitterDecisionCard({
  variant,
  eyebrow,
  title,
  badge,
  summary,
  facts,
  sections,
  footer
}: TwitterDecisionCardProps) {
  return (
    <section className={`agent-panel agent-panel--${variant}`}>
      <div className="agent-panel__header">
        <span className="agent-panel__eyebrow">{eyebrow}</span>
        <div className="agent-panel__title-row">
          <strong>{title}</strong>
          {badge ? <span className="agent-panel__badge">{badge}</span> : null}
        </div>
      </div>

      {summary ? <p className="agent-panel__summary">{summary}</p> : null}

      {facts?.length ? (
        <div className="agent-fact-list">
          {facts.map((fact) => (
            <div key={`${fact.label}:${fact.value}`} className="agent-fact">
              <span className="agent-fact__label">{fact.label}</span>
              <span className="agent-fact__value">{fact.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {sections?.map((section) => (
        <div key={section.label} className="agent-panel__section">
          <span className="agent-panel__section-label">{section.label}</span>
          {section.items.length ? (
            <ul className="agent-panel__list">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="agent-panel__empty">{section.emptyText ?? "暂无"}</p>
          )}
        </div>
      ))}

      {footer ? <div className="agent-panel__footer">{footer}</div> : null}
    </section>
  );
}
