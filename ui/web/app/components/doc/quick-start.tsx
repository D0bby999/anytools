import { useId, type ReactNode } from "react";
import { Link } from "react-router";

export type QuickStartAction = { label: ReactNode; to: string };
export type QuickStartStep = { label: ReactNode; done?: boolean; to?: string };

/**
 * Quick-start (I3): the page's main action, as up's `.quick-start` on its home
 * page. A heading, a one-line description, one primary action and at most
 * two secondary ones, then a line of small print (the
 * cycle) and, for a first visit, the steps still to do.
 */
export function QuickStart({
  title,
  description,
  primary,
  secondary = [],
  cycle,
  steps,
  stepsLabel,
  doneLabel,
}: {
  title: ReactNode;
  description?: ReactNode;
  primary?: QuickStartAction;
  secondary?: QuickStartAction[];
  cycle?: ReactNode;
  steps?: QuickStartStep[];
  stepsLabel?: string;
  /** Read after a done step, so "done" is not carried by the tick alone. */
  doneLabel?: string;
}) {
  const id = `qs-${useId().replace(/:/g, "")}`;
  return (
    <section className="lp-quick-start" aria-labelledby={id}>
      <div className="lp-quick-start-heading">
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {steps && steps.length > 0 ? (
        <ol className="lp-quick-start-steps" aria-label={stepsLabel}>
          {steps.map((step, i) => (
            <li key={i} data-done={step.done ? "true" : undefined}>
              {step.done ? <span aria-hidden="true">✓ </span> : null}
              {step.to && !step.done ? <Link to={step.to}>{step.label}</Link> : step.label}
              {step.done && doneLabel ? <span className="sr-only"> ({doneLabel})</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {primary || secondary.length > 0 ? (
        <div className="lp-quick-start-actions">
          {primary ? (
            <Link to={primary.to} className="lp-quick-start-action lp-quick-start-action-primary">
              {primary.label}
            </Link>
          ) : null}
          {secondary.slice(0, 2).map((action, i) => (
            <Link key={i} to={action.to} className="lp-quick-start-action lp-quick-start-action-secondary">
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
      {cycle ? <p className="lp-quick-start-cycle">{cycle}</p> : null}
    </section>
  );
}
