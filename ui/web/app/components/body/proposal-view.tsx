import { useTranslation } from "react-i18next";
import { num, WEEK_ORDER, weekdayNames, type Names, type Proposal } from "~/lib/body-types";
import { usePolicyName } from "~/components/body/advice";

/**
 * A coach proposal as the learner reviews it: the reading, the changes and
 * the evidence for each, then the whole plan with every exercise's reason.
 * Nothing here applies anything; the page's buttons do.
 */
export function ProposalView({ proposal: p, names }: { proposal: Proposal; names: Names }) {
  const { t, i18n } = useTranslation("body");
  const policyName = usePolicyName();
  const days = weekdayNames(i18n.language);
  const plan = p.plan;
  return (
    <div>
      {p.reading ? <p className="text-sm leading-prose">{p.reading}</p> : null}
      {p.changes.length > 0 ? (
        <>
          <h4 className="mt-4 text-sm font-semibold">{t("coach.changes")}</h4>
          <ul className="mt-2 space-y-2">
            {p.changes.map((c, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{c.what}</span>
                <span className="block text-muted-foreground">{c.why}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {plan ? (
        <>
          <h4 className="mt-4 font-serif text-lg font-semibold">{plan.name}</h4>
          {plan.summary ? <p className="mt-1 text-sm leading-prose">{plan.summary}</p> : null}
          {plan.based_on ? <p className="mt-1 text-xs text-muted-foreground">{t("coach.basedOn", { what: plan.based_on })}</p> : null}
          <ol className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-7">
            {WEEK_ORDER.map((d) => (
              <li key={d} className="flex gap-2 bg-card px-3 py-2 text-sm sm:flex-col sm:gap-1">
                <span className="w-24 shrink-0 text-xs font-semibold text-muted-foreground sm:w-auto">{days[d]}</span>
                {plan.routines.find((r) => r.key === plan.week[d])?.name ?? <span className="text-muted-foreground">{t("week.rest")}</span>}
              </li>
            ))}
          </ol>
          {plan.routines.map((r) => (
            <section key={r.key} className="mt-4">
              <h5 className="flex flex-wrap items-baseline gap-x-3 font-semibold">
                {r.name}
                <span className="text-xs font-normal text-muted-foreground">{policyName(r.prog)}</span>
              </h5>
              {r.why ? <p className="text-sm text-muted-foreground">{r.why}</p> : null}
              <ul className="mt-2 divide-y border-y">
                {r.exercises.map((e, i) => (
                  <li key={`${e.exercise}-${i}`} className="py-2 text-sm">
                    <span className="flex flex-wrap items-baseline gap-x-3">
                      <span className="min-w-0 flex-1 font-medium">{names[e.exercise]?.name ?? e.exercise}</span>
                      <span className="tabular-nums">
                        {e.mode === "time"
                          ? t("target.time", { sets: e.sets, sec: e.sec ?? 0 })
                          : e.mode === "cardio"
                            ? t("target.cardio", { min: num(e.min) })
                            : e.reps_min && e.reps_min < (e.reps ?? 0)
                              ? t("target.range", { sets: e.sets, min: e.reps_min, max: e.reps ?? 0 })
                              : t("target.reps", { sets: e.sets, reps: e.reps ?? 0 })}
                      </span>
                    </span>
                    {e.why ? <span className="block text-muted-foreground">{e.why}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : null}
      {p.notes.length > 0 ? (
        <>
          <h4 className="mt-4 text-sm font-semibold">{t("coach.notes")}</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {p.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
