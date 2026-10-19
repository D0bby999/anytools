/**
 * loop.index.tsx
 * The Learning Loop home: the goal being worked on, its cycle and the gate
 * out of the current phase, this week's review, and what is due from the
 * mastery paths. Other goals are listed below; the four-line start is last.
 */
import { Plate } from "~/components/ui/plate";
import { Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.index";
import { requireUser } from "~/lib/auth.server";
import { listDue } from "~/lib/mastery.server";
import { getCycle, getState, listCardKinds, listRetests, listStates } from "~/lib/loop.server";
import { handleLoopIntent } from "~/lib/loop-actions.server";
import { GatePanel, usePhaseLabels } from "~/components/loop/gate-panel";
import { StartForm } from "~/components/loop/start-form";
import { StateCard } from "~/components/loop/state-card";
import { WeekCard } from "~/components/loop/week-card";
import { ActionError } from "~/components/loop/action-error";
import { CardList, RetestsDueList } from "~/components/loop/card-list";
import { listWorksheets } from "~/lib/worksheets.server";
import { DIAGNOSTIC_KIND } from "~/lib/english-diagnostic";
import { ToolkitLink } from "~/components/worksheet/toolkit-link";
import { PageHeader } from "~/components/ui/page-header";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Learning loop · AnyLearn" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [{ states }, due, retests, { kinds }] = await Promise.all([
    listStates(user.id),
    listDue(user.id, 20).catch(() => ({ due: [], count: 0 })),
    // Due on the learner's own calendar day, decided by the API.
    listRetests(user.id).catch(() => ({ retests: [], count: 0, today: "" })),
    listCardKinds(user.id),
  ]);
  const focus = states[0];
  const detail = focus ? await getState(user.id, focus.id) : null;
  const [cycle, diagnostics] = await Promise.all([
    detail?.cycle ? getCycle(user.id, detail.cycle.id) : null,
    // up methods, phase 1: whether the goal still lacks an English diagnostic
    // (unknown when the list fails, and then nothing is suggested).
    detail ? listWorksheets(user.id, { kind: DIAGNOSTIC_KIND, stateId: detail.state.id }).catch(() => null) : null,
  ]);
  const diagnostic = detail && diagnostics ? { stateId: detail.state.id, missing: diagnostics.length === 0 } : undefined;
  return { states, detail, cycle, due: due.due, retests: retests.retests, kinds, diagnostic };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  return (await handleLoopIntent(user.id, await request.formData())) ?? { error: "Unknown action." };
}

export default function LoopIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const phases = usePhaseLabels();
  const busy = useNavigation().state === "submitting";
  const { states, detail, cycle, due, retests, kinds } = loaderData;
  const thisWeek = cycle?.reviews.find((r) => r.week_no === cycle.current_week);

  return (
    <div className="lp-measure">
      <PageHeader title={t("home.title")} lede={t("home.lead")} />
      <ActionError result={actionData} />

      {/* Retests first: a retest is the one thing here with a day attached. */}
      {retests.length > 0 ? (
        <section aria-labelledby="lp-loop-retests" className="mt-8">
          <h2 id="lp-loop-retests" className="lp-section">
            {t("cards.retests.title")}
          </h2>
          <RetestsDueList retests={retests} kinds={kinds} />
        </section>
      ) : null}

      {detail ? (
        <section aria-labelledby="lp-loop-state" className="mt-8 lp-keybox p-5 sm:p-6">
          <h2 id="lp-loop-state" className="font-sans text-sm font-semibold text-part">
            {t("home.current")}
          </h2>
          <StateCard state={detail.state} />
        </section>
      ) : null}

      {cycle ? (
        <>
          <section aria-labelledby="lp-loop-cycle" className="mt-10">
            <h2 id="lp-loop-cycle" className="lp-section">
              {t("home.cycle")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              <Link to={`/loop/cycle/${cycle.id}`} className="underline underline-offset-4">
                {t("home.week", { week: cycle.current_week })}
              </Link>
            </p>
            <div className="mt-3">
              <GatePanel cycleId={cycle.id} phase={cycle.phase} gate={cycle.gate} busy={busy} />
            </div>
          </section>
          <section aria-labelledby="lp-loop-week" className="mt-10">
            <h2 id="lp-loop-week" className="lp-section">
              {t("home.thisWeek")}
            </h2>
            <WeekCard cycleId={cycle.id} week={cycle.current_week} review={thisWeek} cannotProve={t("week.cannotProve")} />
          </section>
        </>
      ) : null}

      {detail ? (
        <section aria-labelledby="lp-loop-cards" className="mt-10">
          <h2 id="lp-loop-cards" className="lp-section">
            {t("cards.title")}
          </h2>
          <CardList cards={detail.cards} kinds={kinds} diagnostic={loaderData.diagnostic} />
          <Link
            to={`/loop/state/${detail.state.id}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
          >
            {t("cards.new")}
          </Link>
        </section>
      ) : null}

      <section aria-labelledby="lp-loop-due" className="mt-10">
        <h2 id="lp-loop-due" className="lp-section">
          {t("home.due")}
        </h2>
        {due.length === 0 ? (
          <p className="mt-3 lp-empty">{t("home.nothingDue")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {due.map((item) => (
              <li key={item.knowledge_point_id} className="border-b">
                <Link
                  to={`/mastery/${item.path_id}/session`}
                  className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-3 transition-colors hover:bg-primary-soft"
                >
                  <span className="text-sm font-medium">{item.knowledge_point_name}</span>
                  <span className="text-xs text-muted-foreground">{item.path_goal}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {states.length > 1 ? (
        <section aria-labelledby="lp-loop-goals" className="mt-10">
          <h2 id="lp-loop-goals" className="lp-section">
            {t("home.goals")}
          </h2>
          <ul className="mt-3 border-t">
            {states.map((s) => (
              <li key={s.id} className="border-b">
                <Link
                  to={`/loop/state/${s.id}`}
                  className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-3 transition-colors hover:bg-primary-soft"
                >
                  <span className="text-sm font-medium">{s.goal}</span>
                  <span className="text-xs font-semibold text-faint">{s.phase ? phases[s.phase] : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ToolkitLink />

      <section aria-labelledby="lp-loop-start" className="mt-10">
        <h2 id="lp-loop-start" className="lp-section">
          {states.length === 0 ? t("start.first") : t("start.another")}
        </h2>
        {states.length === 0 ? (
          // The first visit: the part's plate beside the form that starts it.
          <div className="grid items-start gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <Plate name="part-reflect" sizes="(min-width: 640px) 15rem, 60vw" className="mt-3 max-w-60" />
            <StartForm busy={busy} />
          </div>
        ) : (
          <StartForm busy={busy} />
        )}
      </section>
    </div>
  );
}
