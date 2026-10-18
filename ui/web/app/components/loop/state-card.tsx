/**
 * state-card.tsx
 * A learning state at a glance: the goal, the real scenario it is for, the
 * twelve-week outcome, and the next task (with its minimum, which is what an
 * interruption shrinks it to, and what the bad-day contract says is still
 * worth keeping).
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { LearningState } from "~/lib/loop-types";

export function StateCard({ state, linked = true }: { state: LearningState; linked?: boolean }) {
  const { t } = useTranslation("loop");
  const rows = [
    { label: t("state.scenario"), value: state.real_scenario },
    { label: t("state.outcome"), value: state.outcome_12w },
    { label: t("state.nextTask"), value: state.next_task },
    { label: t("state.minimum"), value: state.next_task_minimum },
    { label: t("today.keep"), value: state.minimum_contract.still_worth_keeping ?? "" },
  ];
  return (
    <div className="mt-3">
      {linked ? (
        <Link to={`/loop/state/${state.id}`} className="font-serif text-xl underline-offset-4 hover:underline">
          {state.goal}
        </Link>
      ) : (
        <p className="font-serif text-xl">{state.goal}</p>
      )}
      <dl className="mt-3 border-t">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[10rem_1fr] gap-x-3 border-b py-2 text-sm">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd>{r.value || <span className="text-faint">{t("state.empty")}</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
