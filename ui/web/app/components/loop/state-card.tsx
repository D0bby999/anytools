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

/** `showGoal={false}` when the page already titles itself with the goal. */
export function StateCard({
  state,
  linked = true,
  showGoal = true,
}: {
  state: LearningState;
  linked?: boolean;
  showGoal?: boolean;
}) {
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
      {!showGoal ? null : linked ? (
        <Link to={`/loop/state/${state.id}`} className="font-serif text-xl font-semibold underline-offset-4 hover:text-primary hover:underline">
          {state.goal}
        </Link>
      ) : (
        <p className="font-serif text-xl font-semibold">{state.goal}</p>
      )}
      <dl className="mt-3 border-t border-part-line">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-x-4 border-b border-part-line py-2.5 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd>{r.value || <span className="text-faint">{t("state.empty")}</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
