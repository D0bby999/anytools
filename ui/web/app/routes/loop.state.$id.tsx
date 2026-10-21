/**
 * loop.state.$id.tsx
 * One learning state: its fields, its current cycle's gate, the interruption
 * protocol, AI resume with its validated paste-back, the hypotheses weekly
 * reviews wrote back, and its evidence chains and AI briefs.
 *
 * Laid out as up's Learning State Template (plan 261020-2246 phase 12): the
 * five-minute version to copy, then the template's parts as numbered
 * sections, only those the state has fields for; the interruption and the
 * handover folded; then its cards, worksheets, cycle, chains and briefs.
 */
import type { ReactNode } from "react";
import { redirect, useLocation, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.state.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { field, handleLoopIntent, lines, orNotFound } from "~/lib/loop-actions.server";
import { ActionError } from "~/components/loop/action-error";
import { GatePanel } from "~/components/loop/gate-panel";
import { HandoverForm } from "~/components/loop/handover-form";
import { InterruptForm } from "~/components/loop/interrupt-form";
import { RepeatedResistance } from "~/components/loop/repeated-resistance";
import { RESISTANCES, type LearningState, type Resistance } from "~/lib/loop-types";
import {
  SaveState,
  StateBoundaryFields,
  StateEditForm,
  StateGoalFields,
  StateHandoverField,
  StateNextFields,
} from "~/components/loop/state-edit-form";
import { BriefList, ChainList, CycleLinks, Hypotheses } from "~/components/loop/state-lists";
import { CardList } from "~/components/loop/card-list";
import { CardNewForm } from "~/components/loop/card-new-form";
import { listWorksheets } from "~/lib/worksheets.server";
import type { WorksheetSummary } from "~/lib/worksheet-types";
import { DIAGNOSTIC_KIND } from "~/lib/english-diagnostic";
import { StateWorksheets } from "~/components/worksheet/state-worksheets";
import { PageHeader } from "~/components/ui/page-header";
import { CodeBlock } from "~/components/doc/code-block";
import { Details } from "~/components/doc/details";
import { NumberedSection } from "~/components/doc/numbered-section";
import { RefTable } from "~/components/doc/ref-table";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Goal", "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return orNotFound(async () => {
    const [detail, { kinds }, worksheets] = await Promise.all([
      loop.getState(user.id, params.id),
      loop.listCardKinds(user.id),
      // up methods, phase 0: the worksheets attached to this goal.
      listWorksheets(user.id, { stateId: params.id }).catch((): WorksheetSummary[] => []),
    ]);
    return { ...detail, kinds, worksheets };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const id = params.id;
  try {
    switch (field(form, "intent")) {
      case "save":
        await loop.patchState(user.id, id, {
          goal: field(form, "goal"),
          real_scenario: field(form, "real_scenario"),
          outcome_12w: field(form, "outcome_12w"),
          next_task: field(form, "next_task"),
          next_task_minimum: field(form, "next_task_minimum"),
          handover_md: String(form.get("handover_md") ?? ""),
          ai_boundaries: { ai_may: lines(form, "ai_may"), human_must_confirm: lines(form, "human_must_confirm") },
          minimum_contract: {
            downshift_when: field(form, "contract_downshift_when"),
            still_worth_keeping: field(form, "contract_still_worth_keeping"),
            ask_for_help_when: field(form, "contract_ask_for_help_when"),
          },
        });
        return { ok: true };
      case "interrupt":
        await loop.interrupt(user.id, id, {
          fact: field(form, "fact"),
          resistance: resistanceOf(field(form, "resistance")),
          minimum: field(form, "minimum"),
          within_24h: field(form, "within_24h"),
          not_repaying: field(form, "not_repaying"),
          review_on: field(form, "review_on"),
        });
        return { ok: true };
      case "resume":
        return redirect(`/chat/${(await loop.resume(user.id, id)).session_id}`);
      case "handover":
        return {
          handover: await loop.handover(user.id, id, {
            text: String(form.get("text") ?? ""),
            accept: field(form, "accept") === "1",
            accept_next_task: field(form, "accept_next_task") === "1",
          }),
        };
      case "newChain":
        return redirect(`/loop/evidence/${(await loop.createChain(user.id, id, field(form, "question"))).id}`);
      case "newCard": {
        // Only the chosen kind's fields are sent; the API refuses any other.
        const kind = field(form, "kind");
        const setup: Record<string, string> = {};
        for (const [key, value] of form.entries()) {
          if (key.startsWith("setup.") && typeof value === "string" && value.trim()) setup[key.slice(6)] = value;
        }
        const created = await loop.createCard(user.id, id, { kind, title: field(form, "title"), setup });
        return redirect(`/loop/cards/${created.card.id}`);
      }
      case "newBrief":
        return redirect(`/loop/brief/${(await loop.createBrief(user.id, id, field(form, "task"))).id}`);
      case "newCycle":
        await loop.newCycle(user.id, id);
        return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return (await handleLoopIntent(user.id, form)) ?? { error: "Unknown action." };
}

/** A resistance from the form, or "" — the API refuses anything else. */
function resistanceOf(v: string): Resistance | "" {
  return (RESISTANCES as readonly string[]).includes(v) ? (v as Resistance) : "";
}

/** The short version of the day, as a block to copy: the next task, its minimum, what still counts. */
function minimumMarkdown(state: LearningState, labels: { next: string; minimum: string; keep: string }): string {
  return [
    [labels.next, state.next_task],
    [labels.minimum, state.next_task_minimum],
    [labels.keep, state.minimum_contract.still_worth_keeping ?? ""],
  ]
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
}

export default function LoopState({ loaderData, actionData }: Route.ComponentProps) {
  const { hash } = useLocation();
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { state, cycle, gate } = loaderData;
  // up methods, phase 1: language cards start from an English diagnostic.
  const diagnostic = { stateId: state.id, missing: !loaderData.worksheets.some((w) => w.kind === DIAGNOSTIC_KIND) };
  const handover = (actionData && "handover" in actionData ? actionData.handover : null) ?? null;
  const minimum = minimumMarkdown(state, {
    next: t("state.nextTask"),
    minimum: t("state.minimum"),
    keep: t("today.keep"),
  });
  // The parts of up's Learning State Template this state has fields for, in
  // the template's order; "Completed" and "Errors, risks, gaps" have none.
  const parts: { title: string; id: string; body: ReactNode }[] = [
    { title: t("up.state.goal"), id: "lp-state-goal", body: <><StateGoalFields state={state} /><SaveState busy={busy} /></> },
    {
      title: t("up.state.boundaries"),
      id: "lp-state-boundaries",
      body: <><StateBoundaryFields state={state} /><SaveState busy={busy} /></>,
    },
    {
      title: t("up.state.baseline"),
      id: "lp-state-baseline",
      body:
        state.baselines.length === 0 ? (
          <p className="text-muted-foreground">{t("up.state.noBaseline")}</p>
        ) : (
          <RefTable
            caption={t("up.state.baseline")}
            columns={[t("up.state.what"), t("up.state.measure"), t("up.state.at")]}
            rows={state.baselines.map((b) => [b.what, b.measure, b.at])}
          />
        ),
    },
    {
      title: t("up.state.methods"),
      id: "lp-state-methods",
      body:
        state.validated_methods.length === 0 ? (
          <p className="text-muted-foreground">{t("up.state.noMethods")}</p>
        ) : (
          <RefTable
            caption={t("up.state.methods")}
            columns={[t("up.state.method"), t("up.state.evidence")]}
            rows={state.validated_methods.map((m) => [m.method, m.evidence])}
          />
        ),
    },
    { title: t("state.hypotheses"), id: "lp-state-hyp", body: <Hypotheses state={state} /> },
    {
      title: t("up.state.handover"),
      id: "lp-state-handover",
      body: <><StateHandoverField state={state} /><SaveState busy={busy} /></>,
    },
    { title: t("up.state.next"), id: "lp-state-next", body: <><StateNextFields state={state} /><SaveState busy={busy} /></> },
  ];

  return (
    <div>
      <PageHeader title={state.goal} />
      <ActionError result={actionData} />

      <div className="lp-doc">
        <section aria-labelledby="lp-state-minimum">
          <h2 id="lp-state-minimum">{t("up.fiveMinutes")}</h2>
          {minimum ? (
            <>
              <p className="text-muted-foreground">{t("up.state.fiveLead")}</p>
              <CodeBlock code={minimum} lang="md" />
            </>
          ) : (
            <p className="text-muted-foreground">{t("up.state.fiveEmpty")}</p>
          )}
        </section>

        {parts.map((part, i) => (
          <NumberedSection key={part.id} n={i + 1} title={part.title} id={part.id}>
            {part.body}
          </NumberedSection>
        ))}
        <StateEditForm />

        {loaderData.repeated_resistance && cycle ? (
          <RepeatedResistance resistance={loaderData.repeated_resistance} cycleId={cycle.id} />
        ) : null}
        {/* Folded until needed: six fields for a bad week, open on every
            visit, made the goal page mostly a form. Home's "Record an
            interruption" link lands here with the hash, and opens it. */}
        <div id="lp-state-interrupt">
          <Details summary={t("up.state.interrupted")} open={hash === "#lp-state-interrupt"}>
            <InterruptForm minimum={state.next_task_minimum} busy={busy} />
          </Details>
        </div>
        <Details summary={t("up.state.handOver")}>
          <HandoverForm result={handover} busy={busy} />
        </Details>

        <section aria-labelledby="lp-state-cards">
          <h2 id="lp-state-cards">{t("cards.title")}</h2>
          <p className="text-muted-foreground">{t("cards.lead")}</p>
          <CardList cards={loaderData.cards} kinds={loaderData.kinds} diagnostic={diagnostic} />
          <Details summary={t("cards.new")}>
            <CardNewForm kinds={loaderData.kinds} busy={busy} diagnostic={diagnostic} />
          </Details>
        </section>

        <StateWorksheets stateId={state.id} worksheets={loaderData.worksheets} />

        {cycle && gate ? (
          <section aria-labelledby="lp-state-cycle">
            <h2 id="lp-state-cycle">{t("home.cycle")}</h2>
            <GatePanel cycleId={cycle.id} phase={cycle.phase} gate={gate} busy={busy} />
            <CycleLinks cycle={cycle} busy={busy} />
          </section>
        ) : null}

        <section aria-labelledby="lp-state-chains">
          <h2 id="lp-state-chains">{t("chain.title")}</h2>
          <ChainList chains={loaderData.chains} busy={busy} />
        </section>

        <section aria-labelledby="lp-state-briefs">
          <h2 id="lp-state-briefs">{t("brief.title")}</h2>
          <BriefList briefs={loaderData.briefs} busy={busy} />
        </section>
      </div>
    </div>
  );
}
