/**
 * loop.index.tsx
 * The Learning Loop home: the goal being worked on, its cycle and the gate
 * out of the current phase, this week's review, and what is due from the
 * mastery paths. Other goals are listed below; the four-line start is last.
 *
 * Laid out as up's group index (plan 261020-2246 phase 12): the current
 * goal's quick-start, then numbered sections for the goals, this week,
 * retests and cards. The quick-start sits outside the `.lp-doc` article so
 * the article's link rule does not repaint its buttons.
 */
import { Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listDue } from "~/lib/mastery.server";
import { getCycle, getState, listCardKinds, listRetests, listStates } from "~/lib/loop.server";
import { handleLoopIntent } from "~/lib/loop-actions.server";
import { GatePanel, usePhaseLabels } from "~/components/loop/gate-panel";
import { StartForm } from "~/components/loop/start-form";
import { WeekCard } from "~/components/loop/week-card";
import { ActionError } from "~/components/loop/action-error";
import { CardList, RetestsDueList } from "~/components/loop/card-list";
import { listWorksheets } from "~/lib/worksheets.server";
import { DIAGNOSTIC_KIND } from "~/lib/english-diagnostic";
import { ToolkitLink } from "~/components/worksheet/toolkit-link";
import { PageHeader } from "~/components/ui/page-header";
import { Badge } from "~/components/doc/badge";
import { Details } from "~/components/doc/details";
import { NumberedSection } from "~/components/doc/numbered-section";
import { QuickStart } from "~/components/doc/quick-start";
import { RefTable } from "~/components/doc/ref-table";
import { NOTE_JOIN } from "~/lib/sentence";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
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
  const focus = detail?.state;

  return (
    <div>
      <PageHeader title={t("home.title")} lede={t("home.lead")} />
      <ActionError result={actionData} />

      {focus ? (
        <QuickStart
          kicker={t("home.current")}
          title={focus.goal}
          description={`${t("state.nextTask")}: ${focus.next_task || t("state.empty")}`}
          primary={{ label: t("up.loop.doMinimum"), to: `/loop/state/${focus.id}#lp-state-minimum` }}
          secondary={[{ label: t("interrupt.open"), to: `/loop/state/${focus.id}#lp-state-interrupt` }]}
          cycle={t("up.loop.cycle")}
        />
      ) : null}

      <div className="lp-doc">
        <NumberedSection n={1} title={t("up.loop.states")} id="lp-loop-goals">
          {states.length === 0 ? (
            <p className="text-muted-foreground">{t("up.loop.noStates")}</p>
          ) : (
            <RefTable
              caption={t("up.loop.states")}
              columns={[t("start.goal"), t("up.loop.weekColumn"), t("up.gate.gate"), t("up.loop.open")]}
              rows={states.map((s) => {
                const current = s.id === focus?.id && cycle;
                return [
                  s.goal,
                  current ? t("up.loop.week", { week: cycle.current_week }) : "—",
                  current ? (
                    <Badge key="gate" type={cycle.gate.open ? "tip" : "info"}>
                      {phases[cycle.phase]} · {cycle.gate.open ? t("up.gate.open") : t("up.gate.shut")}
                    </Badge>
                  ) : s.phase ? (
                    <Badge key="gate">{phases[s.phase]}</Badge>
                  ) : (
                    "—"
                  ),
                  <Link key="open" to={`/loop/state/${s.id}`} aria-label={`${t("up.loop.open")}: ${s.goal}`}>
                    {t("up.loop.open")}
                  </Link>,
                ];
              })}
            />
          )}
        </NumberedSection>

        {cycle ? (
          <NumberedSection n={2} title={t("home.thisWeek")} id="lp-loop-week">
            <WeekCard cycleId={cycle.id} week={cycle.current_week} review={thisWeek} cannotProve={t("week.cannotProve")} />
            <h3>{t("home.cycle")}</h3>
            <p>
              <Link to={`/loop/cycle/${cycle.id}`}>{t("home.week", { week: cycle.current_week })}</Link>
            </p>
            <GatePanel cycleId={cycle.id} phase={cycle.phase} gate={cycle.gate} busy={busy} />
          </NumberedSection>
        ) : null}

        <NumberedSection n={cycle ? 3 : 2} title={t("cards.retests.title")} id="lp-loop-retests">
          <RetestsDueList retests={retests} kinds={kinds} />
        </NumberedSection>

        {detail ? (
          <NumberedSection n={cycle ? 4 : 3} title={t("cards.title")} id="lp-loop-cards">
            <CardList cards={detail.cards} kinds={kinds} diagnostic={loaderData.diagnostic} />
            <p>
              <Link to={`/loop/state/${detail.state.id}`}>{t("cards.new")}</Link>
            </p>
          </NumberedSection>
        ) : null}

        <section aria-labelledby="lp-loop-due">
          <h2 id="lp-loop-due">{t("home.due")}</h2>
          {due.length === 0 ? (
            <p className="text-muted-foreground">{t("home.nothingDue")}</p>
          ) : (
            <ul className="lp-dated-list">
              {due.map((item) => (
                <li key={item.knowledge_point_id}>
                  <Link to={`/mastery/${item.path_id}/session`}>{item.knowledge_point_name}</Link>
                  {NOTE_JOIN}
                  {item.path_goal}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="lp-loop-start">
          <h2 id="lp-loop-start">{states.length === 0 ? t("start.first") : t("start.another")}</h2>
          {/* Open on a first visit, when starting is the only thing to do here. */}
          <Details summary={t("up.loop.startSummary")} open={states.length === 0}>
            <StartForm busy={busy} />
          </Details>
        </section>

        <ToolkitLink />
      </div>
    </div>
  );
}
