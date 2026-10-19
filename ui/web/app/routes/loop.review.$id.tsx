/**
 * loop.review.$id.tsx
 * One weekly review: the evidence on it, what the week produced that could be
 * evidence, the four scores, and the writeback into the learning state —
 * refused, with reasons, until the review is complete.
 */
import { ArrowLeft } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.review.$id";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { scoreText } from "~/lib/loop-types";
import { field, handleLoopIntent, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { EvidenceRow } from "~/components/loop/evidence-row";
import { Metric } from "~/components/loop/metric";
import { ScoreForm } from "~/components/loop/score-form";
import { SuggestionRow } from "~/components/loop/suggestion-row";
import { PageHeader } from "~/components/ui/page-header";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Weekly review · Learning loop · AnyLearn" }, { name: "robots", content: "noindex, nofollow" }];
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
    <div className="lp-measure">
      <Link
        to={`/loop/cycle/${cycle.id}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("review.backToCycle")}
      </Link>
      <PageHeader title={t("review.title", { week: review.week_no })} lede={cycle.goal} numeral={review.week_no} className="mt-2" />
      <ActionError result={actionData} />

      <section aria-labelledby="lp-rv-evidence" className="mt-8">
        <h2 id="lp-rv-evidence" className="lp-section">
          {t("review.evidence")}
        </h2>
        {evidence.length === 0 ? <p className="mt-3 lp-empty">{t("review.noEvidence")}</p> : null}
        <ul className="mt-3 border-t">
          {evidence.map((e) => (
            <EvidenceRow key={e.id} item={e} editable={!review.writeback_done} />
          ))}
        </ul>
      </section>

      {!review.writeback_done ? (
        <section aria-labelledby="lp-rv-suggest" className="mt-10">
          <h2 id="lp-rv-suggest" className="lp-section">
            {t("review.suggested")}
          </h2>
          <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("review.suggestedLead")}</p>
          {suggestions.length === 0 ? (
            <p className="mt-3 lp-empty">{t("review.noSuggestions")}</p>
          ) : (
            <ul className="mt-3 border-t">
              {suggestions.map((s) => (
                <SuggestionRow key={`${s.kind}:${s.ref_id}`} item={s} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="lp-rv-scores" className="mt-10">
        <h2 id="lp-rv-scores" className="lp-section">
          {t("review.scores")}
        </h2>
        <Metric
          label={t("review.total")}
          value={total === null ? scores.map(scoreText).join(" ") : `${total}/8`}
          cannotProve={detail.cannot_prove}
        />
        <ScoreForm review={review} busy={busy} />
      </section>

      <section aria-labelledby="lp-rv-writeback" className="mt-10">
        <h2 id="lp-rv-writeback" className="lp-section">
          {t("review.writeback")}
        </h2>
        {review.writeback_done ? (
          <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("review.done")}</p>
        ) : (
          <>
            {problems.length > 0 ? (
              <ul className="mt-3 list-disc pl-5 text-sm leading-prose">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("review.ready")}</p>
            )}
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="writeback" />
              <Button type="submit" disabled={busy || problems.length > 0}>
                {t("review.writebackSubmit")}
              </Button>
            </Form>
          </>
        )}
      </section>
    </div>
  );
}
