/**
 * loop.review.$id.tsx
 * One weekly review: the evidence on it, what the week produced that could be
 * evidence, the four scores, and the writeback into the learning state —
 * refused, with reasons, until the review is complete.
 *
 * Laid out as up's Weekly Review Template (plan 261020-2246 phase 12), a
 * numbered section per part. Its "Main question" part is left out: the
 * review's cycle summary carries no weekly question.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.review.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { scoreText } from "~/lib/loop-types";
import { field, handleLoopIntent, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { EvidenceTable } from "~/components/loop/evidence-row";
import { MistakeRows } from "~/components/loop/mistake-rows";
import { Metric } from "~/components/loop/metric";
import { ChangeField, EnergyField, SaveScores, ScoreChecks, ScoreFormShell } from "~/components/loop/score-form";
import { SuggestionRow } from "~/components/loop/suggestion-row";
import { PageHeader } from "~/components/ui/page-header";
import { BookMeta } from "~/components/doc/book-meta";
import { NumberedSection } from "~/components/doc/numbered-section";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Weekly review", "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return orNotFound(async () => {
    const detail = await loop.getReview(user.id, params.id);
    const { suggestions } = await loop.suggest(user.id, detail.cycle.id, detail.review.week_no);
    // Only what is not on the review yet; recorded ones are listed above it.
    return { detail, suggestions: suggestions.filter((s) => !s.status) };
  });
}

function scoreOf(form: FormData, name: string): number | undefined {
  const v = form.get(name);
  return v === null || v === "" ? undefined : Number(v);
}

function mistakes(form: FormData) {
  const col = (n: string) => form.getAll(n).map((v) => String(v).trim());
  const [evidence, cause, test, stop, conf] = ["err_evidence", "err_cause", "err_next_test", "err_stop", "err_confidence"].map(col);
  return (evidence ?? [])
    .map((e, i) => ({
      evidence: e,
      cause: cause?.[i] ?? "",
      next_test: test?.[i] ?? "",
      stop_condition: stop?.[i] ?? "",
      confidence: conf?.[i] ?? "",
    }))
    .filter((m) => m.evidence || m.cause || m.next_test || m.stop_condition);
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    switch (field(form, "intent")) {
      case "score":
        await loop.patchReview(user.id, params.id, {
          completion: scoreOf(form, "completion"),
          quality: scoreOf(form, "quality"),
          retention: scoreOf(form, "retention"),
          transfer: scoreOf(form, "transfer"),
          errors: mistakes(form),
          energy: field(form, "energy"),
          one_variable_change: field(form, "one_variable_change"),
        });
        return { ok: true };
      case "addEvidence":
        await loop.addReviewEvidence(user.id, params.id, {
          kind: field(form, "kind"),
          ref_id: field(form, "ref_id"),
          timepoint: field(form, "timepoint"),
        });
        return { ok: true };
      case "writeback":
        await loop.writeback(user.id, params.id);
        return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return (await handleLoopIntent(user.id, form)) ?? { error: "Unknown action." };
}

export default function LoopReview({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { detail, suggestions } = loaderData;
  const { review, evidence, problems, cycle } = detail;
  const scores = [review.completion, review.quality, review.retention, review.transfer];
  const total = scores.every((s) => s !== null) ? scores.reduce<number>((a, s) => a + (s ?? 0), 0) : null;

  return (
    <div>
      <PageHeader title={t("review.title", { week: review.week_no })} lede={cycle.goal} className="mb-0" />
      <BookMeta
        label={t("up.review.about")}
        items={[
          { label: t("up.cycle.started", { date: cycle.started_at.slice(0, 10) }) },
          { label: t("up.cycle.weekOf", { week: review.week_no }) },
          { label: t("review.backToCycle"), to: `/loop/cycle/${cycle.id}` },
        ]}
      />
      <ActionError result={actionData} />

      <div className="lp-doc">
        <NumberedSection n={1} title={t("up.review.inventory")} id="lp-rv-evidence">
          {evidence.length === 0 ? (
            <p className="text-muted-foreground">{t("review.noEvidence")}</p>
          ) : (
            <EvidenceTable items={evidence} editable={!review.writeback_done} />
          )}
          {!review.writeback_done ? (
            <section aria-labelledby="lp-rv-suggest">
              <h3 id="lp-rv-suggest">{t("review.suggested")}</h3>
              <p className="text-muted-foreground">{t("review.suggestedLead")}</p>
              {suggestions.length === 0 ? (
                <p className="text-muted-foreground">{t("review.noSuggestions")}</p>
              ) : (
                <ul>
                  {suggestions.map((s) => (
                    <SuggestionRow key={`${s.kind}:${s.ref_id}`} item={s} />
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </NumberedSection>

        <NumberedSection n={2} title={t("up.review.checks")} id="lp-rv-scores">
          <ScoreChecks review={review} />
          <Metric
            label={t("review.total")}
            value={total === null ? scores.map(scoreText).join(" ") : `${total}/8`}
            cannotProve={detail.cannot_prove}
          />
        </NumberedSection>

        <NumberedSection n={3} title={t("up.review.errors")} id="lp-rv-errors">
          <MistakeRows errors={review.errors} disabled={review.writeback_done} />
        </NumberedSection>

        <NumberedSection n={4} title={t("up.review.energy")} id="lp-rv-energy-part">
          <EnergyField review={review} />
        </NumberedSection>

        <NumberedSection n={5} title={t("up.review.change")} id="lp-rv-change-part">
          <ChangeField review={review} />
          <SaveScores review={review} busy={busy} />
        </NumberedSection>
        <ScoreFormShell />

        <NumberedSection n={6} title={t("up.review.handover")} id="lp-rv-writeback">
          {review.writeback_done ? (
            <p className="text-muted-foreground">{t("review.done")}</p>
          ) : (
            <>
              {problems.length > 0 ? (
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t("review.ready")}</p>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="writeback" />
                <Button type="submit" disabled={busy || problems.length > 0}>
                  {t("review.writebackSubmit")}
                </Button>
              </Form>
            </>
          )}
          <ul>
            <li>
              <Link to={`/loop/cycle/${cycle.id}`}>{t("review.backToCycle")}</Link>
            </li>
            <li>
              <Link to={`/loop/state/${cycle.state_id}`}>{t("cycle.backToGoal")}</Link>
            </li>
          </ul>
        </NumberedSection>
      </div>
    </div>
  );
}
