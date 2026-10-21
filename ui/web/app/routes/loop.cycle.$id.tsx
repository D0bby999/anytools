/**
 * loop.cycle.$id.tsx
 * One 90-day cycle: its phases and gate, its weekly reviews, the weekly
 * questions, the interruptions logged on it, and its close.
 *
 * Up methods, phase 10: from day 84 on the learner's calendar the page offers
 * "Close this cycle", the structured day-90 close (a cycle_close worksheet,
 * one per cycle). The old free-text review stays, as "Notes". A new cycle
 * whose week 1 is still empty offers the last close's continue and transfer
 * results as week 1's question.
 *
 * Laid out as up's 90-Day Cycle Map (plan 261020-2246 phase 12): the facts
 * line, then the map's parts as numbered sections. Its "Day-one baseline"
 * part is left out: a cycle has no baseline field (baselines live on the
 * learning state and its evidence cards).
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.cycle.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import * as worksheets from "~/lib/worksheets.server";
import { CYCLE_CLOSE_KIND, closeTitle, weekOneIsEmpty, withWeekOne, type CycleCloses } from "~/lib/cycle-close";
import { scoreText, type Phase } from "~/lib/loop-types";
import { field, handleLoopIntent, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { GatePanel, usePhaseLabels } from "~/components/loop/gate-panel";
import { Metric } from "~/components/loop/metric";
import { WeekCard } from "~/components/loop/week-card";
import { WeeklyQuestions } from "~/components/loop/weekly-questions";
import { InterruptionList } from "~/components/loop/interruption-list";
import { CycleCloseLink } from "~/components/loop/cycle-close-link";
import { LastClose } from "~/components/loop/last-close";
import { PageHeader } from "~/components/ui/page-header";
import { BookMeta } from "~/components/doc/book-meta";
import { NumberedSection } from "~/components/doc/numbered-section";
import { NOTE_JOIN } from "~/lib/sentence";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Cycle", "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const cycle = await orNotFound(() => loop.getCycle(user.id, params.id));
  return { ...cycle, closes: await closesOf(user.id, params.id) };
}

const NO_CLOSES: CycleCloses = { close: null, previous: null };

/** The cycle's closes; the page still works, without them, if they cannot be read. */
async function closesOf(userId: string, cycleId: string): Promise<CycleCloses> {
  try {
    return await worksheets.cycleCloses(userId, cycleId);
  } catch (error) {
    if (error instanceof ApiError) return NO_CLOSES;
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    switch (field(form, "intent")) {
      case "questions": {
        const capacities = form.getAll("capacity").map(String);
        const questions = form.getAll("question").map((q, i) => ({
          question: String(q).trim(),
          capacity: capacities[i] || "full",
        }));
        // Trailing empty weeks are not stored; empty weeks in the middle are.
        while (questions.length && !questions[questions.length - 1]?.question) questions.pop();
        await loop.patchCycle(user.id, params.id, { weekly_questions: questions });
        return { ok: true };
      }
      case "day90":
        await loop.patchCycle(user.id, params.id, { day90_review_md: String(form.get("day90") ?? "") });
        return { ok: true };
      case "close-cycle":
        return redirect(`/toolkit/${await openClose(user.id, params.id, field(form, "title"))}`);
      case "from-close": {
        // The row is looked up again here: week 1 takes the next step the
        // last close holds now, and only from a row it still offers.
        const row = Number(field(form, "row"));
        const [cycle, closes] = await Promise.all([
          loop.getCycle(user.id, params.id),
          worksheets.cycleCloses(user.id, params.id),
        ]);
        const offer = closes.previous?.offers.find((o) => o.row === row);
        if (!offer) return { errorKey: "cycleClose.gone" as const };
        if (!weekOneIsEmpty(cycle.weekly_questions)) return { errorKey: "cycleClose.weekOneTaken" as const };
        await loop.patchCycle(user.id, params.id, {
          weekly_questions: withWeekOne(cycle.weekly_questions, offer.next_step),
        });
        return { ok: true };
      }
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  form.set("cycle_id", params.id);
  return (await handleLoopIntent(user.id, form)) ?? { error: "Unknown action." };
}

/** The cycle's close: a new one, or the one it already has. */
async function openClose(userId: string, cycleId: string, title: string): Promise<string> {
  try {
    const created = await worksheets.createWorksheet(userId, {
      kind: CYCLE_CLOSE_KIND,
      title: closeTitle(title),
      cycle_id: cycleId,
    });
    return created.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.code === "cycle_closed") {
      const { close } = await worksheets.cycleCloses(userId, cycleId);
      if (close) return close.id;
    }
    throw error;
  }
}

export default function LoopCycle({ loaderData: c, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const phases = usePhaseLabels();
  const busy = useNavigation().state === "submitting";
  const thisWeek = c.reviews.find((r) => r.week_no === c.current_week);
  const errorKey = actionData && "errorKey" in actionData ? actionData.errorKey : undefined;

  return (
    <div>
      <PageHeader title={c.goal} className="mb-0" />
      <BookMeta
        label={t("up.cycle.about")}
        items={[
          { label: t("up.cycle.started", { date: c.started_at.slice(0, 10) }) },
          { label: t("up.cycle.weekOf", { week: c.current_week }) },
          { label: `${phases[c.phase]} · ${c.gate.final ? t("up.gate.final") : c.gate.open ? t("up.gate.open") : t("up.gate.shut")}` },
          { label: t("cycle.backToGoal"), to: `/loop/state/${c.state_id}` },
        ]}
      />
      <ActionError result={errorKey ? { error: t(errorKey) } : actionData} />

      <div className="lp-doc">
        <NumberedSection n={1} title={t("up.cycle.commitment")} id="lp-cycle-commitment">
          <p>{t("up.cycle.commitmentBody")}</p>
          <p>
            <Link to={`/loop/state/${c.state_id}`}>{t("cycle.backToGoal")}</Link>
          </p>
        </NumberedSection>

        <NumberedSection n={2} title={t("up.cycle.gates")} id="lp-cycle-gate">
          <GatePanel cycleId={c.id} phase={c.phase} gate={c.gate} busy={busy} />
        </NumberedSection>

        <NumberedSection n={3} title={t("up.cycle.questions")} id="lp-cycle-questions">
          {c.closes.previous && weekOneIsEmpty(c.weekly_questions) ? (
            <section aria-labelledby="lp-cycle-last-close">
              <h3 id="lp-cycle-last-close">{t("cycleClose.fromLast")}</h3>
              <LastClose previous={c.closes.previous} busy={busy} />
            </section>
          ) : null}
          <WeeklyQuestions questions={c.weekly_questions} busy={busy} />

          <h3>{t("home.thisWeek")}</h3>
          <WeekCard cycleId={c.id} week={c.current_week} review={thisWeek} cannotProve={t("week.cannotProve")} />

          <h3>{t("cycle.reviews")}</h3>
          {c.reviews.length === 0 ? <p className="text-muted-foreground">{t("cycle.noReviews")}</p> : null}
          {c.reviews.map((r) => (
            <Link key={r.id} to={`/loop/review/${r.id}`} className="block no-underline! hover:bg-hover">
              <Metric
                label={t("cycle.reviewRow", { week: r.week_no })}
                value={[r.completion, r.quality, r.retention, r.transfer].map(scoreText).join(" ")}
                cannotProve={t("week.cannotProve")}
              />
            </Link>
          ))}
        </NumberedSection>

        <NumberedSection n={4} title={t("up.cycle.chain")} id="lp-cycle-chain">
          {c.gate_evidence.length === 0 ? (
            <p className="text-muted-foreground">{t("up.cycle.noChain")}</p>
          ) : (
            <ul className="lp-dated-list">
              {c.gate_evidence.map((g) => (
                <li key={`${g.from}-${g.at}`}>
                  <strong>{g.at.slice(0, 10)}</strong>
                  {" · "}
                  {phases[g.from as Phase] ?? g.from} → {phases[g.to as Phase] ?? g.to}
                  {NOTE_JOIN}
                  {t("up.cycle.passed", { count: g.reviews, refs: g.ref_ids.length })}
                </li>
              ))}
            </ul>
          )}
        </NumberedSection>

        <NumberedSection n={5} title={t("up.cycle.interruptions")} id="lp-cycle-int">
          {c.interruptions.length === 0 ? (
            <p className="text-muted-foreground">{t("up.cycle.noInterruptions")}</p>
          ) : (
            <InterruptionList items={c.interruptions} />
          )}
        </NumberedSection>

        <NumberedSection n={6} title={t("up.cycle.day90")} id="lp-cycle-90">
          <h3 id="lp-cycle-close">{t("cycleClose.region")}</h3>
          <CycleCloseLink goal={c.goal} day={c.day} closeFromDay={c.close_from_day} close={c.closes.close} busy={busy} />

          <h3 id="lp-cycle-notes">{t("cycleClose.notes")}</h3>
          <p className="text-muted-foreground">{t("cycleClose.notesLead")}</p>
          <Form method="post">
            <input type="hidden" name="intent" value="day90" />
            <textarea
              name="day90"
              aria-label={t("cycleClose.notes")}
              rows={6}
              defaultValue={c.day90_review_md}
              className="mb-4 w-full rounded-md border border-control-border bg-card px-4 py-2 text-sm"
            />
            <Button type="submit" variant="outline" disabled={busy}>
              {t("state.save")}
            </Button>
          </Form>
        </NumberedSection>
      </div>
    </div>
  );
}
