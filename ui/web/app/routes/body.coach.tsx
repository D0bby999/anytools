/**
 * body.coach.tsx
 * Body → Coach: a plan drafted from a short intake, a review of the log, and
 * revisions in the learner's own words, all on the model they routed for
 * Chat. Every proposal waits for Accept; an accepted one can be undone.
 */
import { Form, Link, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { useLibraryTerm } from "~/components/body/muscles";
import type { Route } from "./+types/body.coach";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { coachPlan, coachRefine, coachReview, decideProposal, getOverview, listProposals, searchExercises } from "~/lib/body.server";
import { EXPERIENCES, GOALS, WEEK_ORDER, weekdayNames, type Intake } from "~/lib/body-types";
import { BodyTabs } from "~/components/body/body-tabs";
import { FIELD } from "~/components/body/fields";
import { ProposalView } from "~/components/body/proposal-view";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { DateText } from "~/components/ui/date-text";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Training coach") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const [{ proposals, names }, { overview }, { facets }] = await Promise.all([
    listProposals(userId),
    getOverview(userId),
    searchExercises(userId, { limit: 1 }),
  ]);
  return { proposals, names, intake: overview.profile.intake, hasPlan: overview.routines.length > 0, equipment: facets.equipment };
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  try {
    switch (String(form.get("intent") ?? "")) {
      case "plan": {
        const intake: Intake = {
          goal: String(form.get("goal") ?? ""),
          experience: String(form.get("experience") ?? ""),
          days_per_week: Number(form.get("days_per_week")),
          preferred_days: form.getAll("preferred_days").map(Number),
          session_min: Number(form.get("session_min")),
          equipment: form.getAll("equipment").map(String),
          limitations: String(form.get("limitations") ?? ""),
          note: String(form.get("note") ?? ""),
        };
        await coachPlan(userId, intake);
        return { done: "plan" };
      }
      case "review":
        await coachReview(userId, String(form.get("text") ?? ""));
        return { done: "review" };
      case "refine":
        await coachRefine(userId, id, String(form.get("text") ?? ""));
        return { done: "refine" };
      case "accept":
      case "decline":
      case "revert":
        await decideProposal(userId, id, String(form.get("intent")) as "accept" | "decline" | "revert");
        return { done: String(form.get("intent")) };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.code ?? "", detail: error.message };
    return { error: "", detail: "" };
  }
  return { error: "", detail: "" };
}

export default function BodyCoach({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("body");
  const term = useLibraryTerm();
  const { proposals, names, intake, hasPlan, equipment } = loaderData;
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const thinking = nav.state !== "idle" && ["plan", "review", "refine"].includes(String(nav.formData?.get("intent") ?? ""));
  const busy = nav.state !== "idle";
  const days = weekdayNames(i18n.language);
  const waiting = proposals.find((p) => p.status === "proposed") ?? null;
  const past = proposals.filter((p) => p !== waiting);

  return (
    <div className="lp-doc">
      <PageHeader title={t("coach.title")} lede={t("coach.lead")} />
      <BodyTabs />
      <p className="mb-6 max-w-[64ch] text-sm leading-snug text-muted-foreground">
        {t("coach.privacy")}{" "}
        <Link to="/settings/routes" className="font-medium text-primary underline underline-offset-4">
          {t("coach.routes")}
        </Link>
      </p>

      {result && "error" in result ? (
        <Alert variant="destructive" className="mb-6">
          {result.error === "no_provider"
            ? t("coach.noProvider")
            : result.error === "coach_failed"
              ? t("coach.failed")
              : t("errors.generic")}
          {result.detail && result.error !== "no_provider" ? ` (${result.detail})` : null}
        </Alert>
      ) : null}
      {thinking ? (
        <Alert className="mb-6" role="status">
          {t("coach.thinking")}
        </Alert>
      ) : null}

      {waiting ? (
        <section data-part="practise" aria-labelledby="lp-coach-waiting" className="mb-10">
          <h2 id="lp-coach-waiting" className="lp-section text-xl">
            {waiting.kind === "plan" ? t("coach.waitingPlan") : t("coach.waitingReview")}
          </h2>
          <div className="mt-3">
            <ProposalView proposal={waiting} names={names} />
          </div>
          <Form method="post" className="mt-5 flex flex-wrap gap-3">
            <input type="hidden" name="id" value={waiting.id} />
            <Button type="submit" name="intent" value="accept" disabled={busy}>
              {waiting.nochange ? t("coach.ok") : hasPlan ? t("coach.acceptReplace") : t("coach.accept")}
            </Button>
            {waiting.nochange ? null : (
              <Button type="submit" name="intent" value="decline" variant="outline" disabled={busy}>
                {t("coach.decline")}
              </Button>
            )}
          </Form>
          {waiting.kind === "plan" ? (
            <Form method="post" className="mt-5">
              <input type="hidden" name="intent" value="refine" />
              <input type="hidden" name="id" value={waiting.id} />
              <label className="block text-xs text-muted-foreground">
                {t("coach.refine")}
                <textarea
                  name="text"
                  required
                  maxLength={1000}
                  rows={2}
                  placeholder={t("coach.refineExample")}
                  className={`${FIELD} py-2`}
                />
              </label>
              <Button type="submit" variant="outline" className="mt-3" disabled={busy}>
                {t("coach.refineGo")}
              </Button>
            </Form>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="lp-coach-intake">
        <h2 id="lp-coach-intake" className="lp-section">
          {t("coach.draftTitle")}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-snug text-muted-foreground">{t("coach.draftLead")}</p>
        <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="plan" />
          <label className="text-xs text-muted-foreground">
            {t("intake.goal")}
            <select name="goal" required defaultValue={intake?.goal ?? "fitness"} className={FIELD}>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {g === "strength"
                    ? t("goal.strength")
                    : g === "muscle"
                      ? t("goal.muscle")
                      : g === "fat_loss"
                        ? t("goal.fatLoss")
                        : g === "fitness"
                          ? t("goal.fitness")
                          : t("goal.health")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("intake.experience")}
            <select name="experience" required defaultValue={intake?.experience ?? "new"} className={FIELD}>
              {EXPERIENCES.map((x) => (
                <option key={x} value={x}>
                  {x === "new" ? t("experience.new") : x === "some" ? t("experience.some") : t("experience.experienced")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("intake.days")}
            <input
              type="number"
              name="days_per_week"
              required
              min="1"
              max="7"
              defaultValue={intake?.days_per_week ?? 3}
              className={FIELD}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("intake.minutes")}
            <input
              type="number"
              name="session_min"
              required
              min="10"
              max="180"
              step="5"
              defaultValue={intake?.session_min ?? 45}
              className={FIELD}
            />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs text-muted-foreground">{t("intake.preferred")}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {WEEK_ORDER.map((d) => (
                <label key={d} className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="preferred_days"
                    value={d}
                    defaultChecked={intake?.preferred_days.includes(d)}
                    className="size-4"
                  />
                  {days[d]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs text-muted-foreground">{t("intake.equipment")}</legend>
            <p className="text-xs text-muted-foreground">{t("intake.equipmentNote")}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              {equipment.map((eq) => (
                <label key={eq} className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="equipment" value={eq} defaultChecked={intake?.equipment.includes(eq)} className="size-4" />
                  {term(eq)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {t("intake.limitations")}
            <textarea name="limitations" maxLength={1000} rows={2} defaultValue={intake?.limitations ?? ""} className={`${FIELD} py-2`} />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {t("intake.note")}
            <textarea name="note" maxLength={1000} rows={2} defaultValue={intake?.note ?? ""} className={`${FIELD} py-2`} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy} aria-busy={thinking}>
              {t("coach.draft")}
            </Button>
          </div>
        </Form>
      </section>

      <section aria-labelledby="lp-coach-review" className="mt-10">
        <h2 id="lp-coach-review" className="lp-section">
          {t("coach.reviewTitle")}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-snug text-muted-foreground">{t("coach.reviewLead")}</p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="review" />
          <label className="block text-xs text-muted-foreground">
            {t("coach.reviewNote")}
            <textarea name="text" maxLength={1000} rows={2} className={`${FIELD} py-2`} />
          </label>
          <Button type="submit" variant="outline" className="mt-3" disabled={busy || !hasPlan}>
            {t("coach.reviewGo")}
          </Button>
          {!hasPlan ? <p className="mt-2 text-sm text-muted-foreground">{t("coach.reviewNeedsPlan")}</p> : null}
        </Form>
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="lp-coach-past" className="mt-10">
          <h2 id="lp-coach-past" className="lp-section">
            {t("coach.past")}
          </h2>
          <ul className="mt-3 divide-y border-y">
            {past.map((p) => (
              <li key={p.id} className="py-3">
                <details className="lp-details">
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 text-sm">
                    <span className="font-medium">{p.kind === "plan" ? (p.plan?.name ?? t("coach.plan")) : t("coach.review")}</span>
                    <span className="text-muted-foreground">
                      {p.status === "accepted"
                        ? t("status.accepted")
                        : p.status === "declined"
                          ? t("status.declined")
                          : p.status === "reverted"
                            ? t("status.reverted")
                            : t("status.replaced")}
                    </span>
                    <DateText iso={p.created_at} className="ml-auto text-xs text-muted-foreground" />
                  </summary>
                  <div className="mt-3">
                    <ProposalView proposal={p} names={names} />
                  </div>
                </details>
                {p.can_revert ? (
                  <Form method="post" className="mt-2">
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" name="intent" value="revert" size="sm" variant="ghost" disabled={busy}>
                      {t("coach.revert")}
                    </Button>
                  </Form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
