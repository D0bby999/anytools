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
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.cycle.$id";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import * as worksheets from "~/lib/worksheets.server";
import { CYCLE_CLOSE_KIND, closeTitle, weekOneIsEmpty, withWeekOne, type CycleCloses } from "~/lib/cycle-close";
import { scoreText } from "~/lib/loop-types";
import { field, handleLoopIntent, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { GatePanel } from "~/components/loop/gate-panel";
import { Metric } from "~/components/loop/metric";
import { WeekCard } from "~/components/loop/week-card";
import { WeeklyQuestions } from "~/components/loop/weekly-questions";
import { InterruptionList } from "~/components/loop/interruption-list";
import { CycleCloseLink } from "~/components/loop/cycle-close-link";
import { LastClose } from "~/components/loop/last-close";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Cycle · Learning loop · AnyTools" }, { name: "robots", content: "noindex, nofollow" }];
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
  const busy = useNavigation().state === "submitting";
  const thisWeek = c.reviews.find((r) => r.week_no === c.current_week);
  const errorKey = actionData && "errorKey" in actionData ? actionData.errorKey : undefined;

  return (
    <div className="lp-measure">
      <div className="lp-prose">
        <h1>{c.goal}</h1>
        <p>{t("cycle.lead", { date: c.started_at.slice(0, 10), week: c.current_week })}</p>
      </div>
      <Link to={`/loop/state/${c.state_id}`} className="text-sm text-primary underline underline-offset-4">
        {t("cycle.backToGoal")}
      </Link>
      <ActionError result={errorKey ? { error: t(errorKey) } : actionData} />

      <section aria-labelledby="lp-cycle-gate" className="mt-8">
        <h2 id="lp-cycle-gate" className="lp-kicker">
          {t("cycle.gate")}
        </h2>
        <div className="mt-3">
          <GatePanel cycleId={c.id} phase={c.phase} gate={c.gate} busy={busy} />
        </div>
      </section>

      <section aria-labelledby="lp-cycle-week" className="mt-10">
        <h2 id="lp-cycle-week" className="lp-kicker">
          {t("home.thisWeek")}
        </h2>
        <WeekCard cycleId={c.id} week={c.current_week} review={thisWeek} cannotProve={t("week.cannotProve")} />
      </section>

      <section aria-labelledby="lp-cycle-reviews" className="mt-10">
        <h2 id="lp-cycle-reviews" className="lp-kicker">
          {t("cycle.reviews")}
        </h2>
        {c.reviews.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("cycle.noReviews")}</p> : null}
        <div className="mt-3">
          {c.reviews.map((r) => (
            <Link key={r.id} to={`/loop/review/${r.id}`} className="block transition-colors hover:bg-primary-soft">
              <Metric
                label={t("cycle.reviewRow", { week: r.week_no })}
                value={[r.completion, r.quality, r.retention, r.transfer].map(scoreText).join(" ")}
                cannotProve={t("week.cannotProve")}
              />
            </Link>
          ))}
        </div>
      </section>

      {c.closes.previous && weekOneIsEmpty(c.weekly_questions) ? (
        <section aria-labelledby="lp-cycle-last-close" className="mt-10">
          <h2 id="lp-cycle-last-close" className="lp-kicker">
            {t("cycleClose.fromLast")}
          </h2>
          <LastClose previous={c.closes.previous} busy={busy} />
        </section>
      ) : null}

      <section aria-labelledby="lp-cycle-questions" className="mt-10">
        <h2 id="lp-cycle-questions" className="lp-kicker">
          {t("cycle.questions")}
        </h2>
        <WeeklyQuestions questions={c.weekly_questions} busy={busy} />
      </section>

      {c.interruptions.length > 0 ? (
        <section aria-labelledby="lp-cycle-int" className="mt-10">
          <h2 id="lp-cycle-int" className="lp-kicker">
            {t("cycle.interruptions")}
          </h2>
          <InterruptionList items={c.interruptions} />
        </section>
      ) : null}

      <section aria-labelledby="lp-cycle-close" className="mt-10">
        <h2 id="lp-cycle-close" className="lp-kicker">
          {t("cycleClose.region")}
        </h2>
        <CycleCloseLink
          goal={c.goal}
          day={c.day}
          closeFromDay={c.close_from_day}
          close={c.closes.close}
          busy={busy}
        />
      </section>

      <section aria-labelledby="lp-cycle-90" className="mt-10">
        <h2 id="lp-cycle-90" className="lp-kicker">
          {t("cycleClose.notes")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("cycleClose.notesLead")}</p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="day90" />
          <textarea
            name="day90"
            aria-label={t("cycleClose.notes")}
            rows={6}
            defaultValue={c.day90_review_md}
            className="w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline" className="mt-2" disabled={busy}>
            {t("state.save")}
          </Button>
        </Form>
      </section>
    </div>
  );
}
