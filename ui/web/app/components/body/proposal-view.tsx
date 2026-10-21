/**
 * A coach proposal as the learner reviews it: the reading, the changes and
 * the evidence for each, then the whole plan with every exercise's reason.
 * Nothing here applies anything; the page's buttons do.
 */
import { Details } from "~/components/doc/details";
import { RefTable } from "~/components/doc/ref-table";
import { useTranslation } from "react-i18next";
import { num, WEEK_ORDER, weekdayNames, type Names, type Proposal } from "~/lib/body-types";
import { usePolicyName } from "~/components/body/advice";

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
          <h3 className="mt-4 text-sm font-semibold">{t("coach.changes")}</h3>
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
          <h3 className="mt-4 font-serif text-lg font-semibold">{plan.name}</h3>
          {plan.summary ? <p className="mt-1 text-sm leading-prose">{plan.summary}</p> : null}
          {plan.based_on ? <p className="mt-1 text-xs text-muted-foreground">{t("coach.basedOn", { what: plan.based_on })}</p> : null}
          <RefTable
            caption={plan.name}
            columns={[t("up.day"), t("today.routine")]}
            rows={WEEK_ORDER.map((d) => [days[d], plan.routines.find((r) => r.key === plan.week[d])?.name ?? t("week.rest")])}
          />
          {plan.routines.map((r) => (
            <section key={r.key} className="mt-4">
              <h3 className="flex flex-wrap items-baseline gap-x-3 font-semibold">
                {r.name}
                <span className="text-xs font-normal text-muted-foreground">{policyName(r.prog)}</span>
              </h3>
              {r.why ? <p className="text-sm text-muted-foreground">{r.why}</p> : null}
              <RefTable
                caption={r.name}
                columns={[t("up.exercise"), t("up.target"), t("up.why")]}
                rows={r.exercises.map((e) => [
                  names[e.exercise]?.name ?? e.exercise,
                  e.mode === "time"
                    ? t("target.time", { sets: e.sets, sec: e.sec ?? 0 })
                    : e.mode === "cardio"
                      ? t("target.cardio", { min: num(e.min) })
                      : e.reps_min && e.reps_min < (e.reps ?? 0)
                        ? t("target.range", { sets: e.sets, min: e.reps_min, max: e.reps ?? 0 })
                        : t("target.reps", { sets: e.sets, reps: e.reps ?? 0 }),
                  e.why ? <Details summary={t("up.why")}>{e.why}</Details> : null,
                ])}
              />
            </section>
          ))}
        </>
      ) : null}
      {p.notes.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">{t("coach.notes")}</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {p.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
