/**
 * loop.state.$id.tsx
 * One learning state: its fields, its current cycle's gate, the interruption
 * protocol, AI resume with its validated paste-back, the hypotheses weekly
 * reviews wrote back, and its evidence chains and AI briefs.
 */
import { redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.state.$id";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { field, handleLoopIntent, lines, orNotFound } from "~/lib/loop-actions.server";
import { ActionError } from "~/components/loop/action-error";
import { GatePanel } from "~/components/loop/gate-panel";
import { HandoverForm } from "~/components/loop/handover-form";
import { InterruptForm } from "~/components/loop/interrupt-form";
import { RepeatedResistance } from "~/components/loop/repeated-resistance";
import { RESISTANCES, type Resistance } from "~/lib/loop-types";
import { StateCard } from "~/components/loop/state-card";
import { StateEditForm } from "~/components/loop/state-edit-form";
import { StateLists } from "~/components/loop/state-lists";
import { CardList } from "~/components/loop/card-list";
import { CardNewForm } from "~/components/loop/card-new-form";
import { listWorksheets } from "~/lib/worksheets.server";
import type { WorksheetSummary } from "~/lib/worksheet-types";
import { DIAGNOSTIC_KIND } from "~/lib/english-diagnostic";
import { StateWorksheets } from "~/components/worksheet/state-worksheets";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Goal · Learning loop · AnyTools" }, { name: "robots", content: "noindex, nofollow" }];
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

export default function LoopState({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { state, cycle, gate } = loaderData;
  // up methods, phase 1: language cards start from an English diagnostic.
  const diagnostic = { stateId: state.id, missing: !loaderData.worksheets.some((w) => w.kind === DIAGNOSTIC_KIND) };
  const handover = (actionData && "handover" in actionData ? actionData.handover : null) ?? null;

  return (
    <div className="lp-measure">
      <StateCard state={state} linked={false} />
      <ActionError result={actionData} />

      {cycle && gate ? (
        <section aria-labelledby="lp-state-cycle" className="mt-10">
          <h2 id="lp-state-cycle" className="lp-kicker">
            {t("home.cycle")}
          </h2>
          <div className="mt-3">
            <GatePanel cycleId={cycle.id} phase={cycle.phase} gate={gate} busy={busy} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="lp-state-interrupt" className="mt-10">
        <h2 id="lp-state-interrupt" className="lp-kicker">
          {t("interrupt.title")}
        </h2>
        {loaderData.repeated_resistance && cycle ? (
          <RepeatedResistance resistance={loaderData.repeated_resistance} cycleId={cycle.id} />
        ) : null}
        <InterruptForm minimum={state.next_task_minimum} busy={busy} />
      </section>

      <section aria-labelledby="lp-state-resume" className="mt-10">
        <h2 id="lp-state-resume" className="lp-kicker">
          {t("resume.title")}
        </h2>
        <HandoverForm result={handover} busy={busy} />
      </section>

      <StateLists detail={loaderData} busy={busy} />

      <section aria-labelledby="lp-state-cards" className="mt-10">
        <h2 id="lp-state-cards" className="lp-kicker">
          {t("cards.title")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("cards.lead")}</p>
        <CardList cards={loaderData.cards} kinds={loaderData.kinds} diagnostic={diagnostic} />
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-primary">{t("cards.new")}</summary>
          <CardNewForm kinds={loaderData.kinds} busy={busy} diagnostic={diagnostic} />
        </details>
      </section>

      <StateWorksheets stateId={state.id} worksheets={loaderData.worksheets} />

      <section aria-labelledby="lp-state-edit" className="mt-10">
        <h2 id="lp-state-edit" className="lp-kicker">
          {t("state.edit")}
        </h2>
        <StateEditForm state={state} busy={busy} />
      </section>
    </div>
  );
}
