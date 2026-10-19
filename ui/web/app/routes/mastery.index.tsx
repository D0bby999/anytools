/**
 * mastery.index.tsx
 * The learner's mastery paths, what is due across all of them, and the form
 * that starts another.
 *
 * Creating a path returns the model's proposed plan from the ACTION, and the
 * learner edits and approves it here. The proposal is not re-requested by any
 * loader: a page reload must not spend a model call on the learner's key.
 */
import { PlateEmpty } from "~/components/ui/plate";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/mastery.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { listKBs } from "~/lib/kb.server";
import { createPath, listDue, listPaths } from "~/lib/mastery.server";
import { percent } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { ProposalEditor } from "~/components/mastery/proposal-editor";
import { MasteryTabs } from "~/components/vocab/mastery-tabs";
import { ReviewAllLink } from "~/components/mastery/review-all-link";
import { dueCards } from "~/lib/vocab.server";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Mastery") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [{ paths }, { knowledge_bases }, due, vocabDue, bookDue] = await Promise.all([
    listPaths(user.id),
    listKBs(user.id),
    listDue(user.id),
    dueCards(user.id, 0).then((d) => d.due_count).catch((): number | null => null),
    dueCards(user.id, 0, "book").then((d) => d.due_count).catch((): number | null => null),
  ]);
  return {
    paths: paths.filter((p) => p.path.status === "active"),
    kbs: knowledge_bases.filter((s) => s.ready > 0).map((s) => ({ id: s.kb.id, name: s.kb.name })),
    due: due.due,
    vocabDue,
    bookDue,
    // A knowledge base page links here with ?kb= to plan a path from it.
    selectedKb: new URL(request.url).searchParams.get("kb") ?? "",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const kbId = String(form.get("kb_id") ?? "");
  const goal = String(form.get("goal") ?? "").trim();
  if (!kbId) return { errorKey: "errors.chooseKb", errorDetail: "" };
  if (!goal) return { errorKey: "errors.goalRequired", errorDetail: "" };

  try {
    const created = await createPath(user.id, kbId, goal);
    return { created };
  } catch (error) {
    return { errorKey: "errors.createPathFailed", errorDetail: error instanceof ApiError ? error.message : "" };
  }
}

export default function MasteryIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const navigation = useNavigation();
  // The path summaries count every due point, where the due list below is
  // capped; the cross-path review is offered once two paths have any.
  const duePaths = loaderData.paths.filter((p) => p.due_count > 0);
  const dueTotal = duePaths.reduce((sum, p) => sum + p.due_count, 0);
  const creating = navigation.state === "submitting" && navigation.formMethod === "POST";
  const created = actionData && "created" in actionData ? actionData.created : undefined;

  return (
    <div className="lp-measure">
      <PageHeader title={t("mastery.title")} lede={t("mastery.lead")} />
      <MasteryTabs vocabDue={loaderData.vocabDue} bookDue={loaderData.bookDue} />

      <section aria-labelledby="lp-mastery-due" className="mt-8">
        <h2 id="lp-mastery-due" className="lp-section">
          {t("mastery.due")}
        </h2>
        <ReviewAllLink count={dueTotal} paths={duePaths.length} />
        {loaderData.due.length === 0 ? (
          <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("mastery.nothingDue")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {loaderData.due.map((item) => (
              <li key={item.knowledge_point_id} className="border-b">
                <Link
                  to={`/mastery/${item.path_id}/session`}
                  className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 transition-colors hover:bg-primary-soft"
                >
                  <span className="text-sm font-medium">{item.knowledge_point_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.module_name} · {item.path_goal}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lp-mastery-paths" className="mt-10">
        <h2 id="lp-mastery-paths" className="lp-section">
          {t("mastery.paths")}
        </h2>
        {loaderData.paths.length === 0 ? (
          <PlateEmpty name="part-practise" className="mt-3">
            {t("mastery.noPaths")}
          </PlateEmpty>
        ) : (
          <ul className="mt-3 border-t">
            {loaderData.paths.map((p) => (
              <li key={p.path.id} className="border-b">
                <Link
                  to={`/mastery/${p.path.id}`}
                  className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 transition-colors hover:bg-primary-soft"
                >
                  <span className="font-sans text-base font-medium">{p.path.goal}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.modules === 0
                      ? t("mastery.notPlanned")
                      : t("mastery.summary", {
                          mastery: percent(p.mastery),
                          due: p.due_count,
                          graduated: p.graduated_modules,
                          modules: p.modules,
                        })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lp-mastery-new" className="mt-10">
        <h2 id="lp-mastery-new" className="lp-section">
          {t("mastery.new")}
        </h2>
        {loaderData.kbs.length === 0 ? (
          <p className="mt-3 lp-empty">{t("quiz.noKb")}</p>
        ) : (
          <Form method="post" className="mt-3 space-y-4 rounded-lg border bg-card p-4">
            <div>
              <label htmlFor="lp-path-kb" className="block text-sm font-medium">
                {t("quiz.kb")}
              </label>
              <select
                id="lp-path-kb"
                name="kb_id"
                required
                defaultValue={loaderData.selectedKb || undefined}
                className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
              >
                {loaderData.kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lp-path-goal" className="block text-sm font-medium">
                {t("mastery.goal")}
              </label>
              <input
                id="lp-path-goal"
                name="goal"
                required
                maxLength={500}
                placeholder={t("mastery.goalPlaceholder")}
                className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? t("mastery.planning") : t("mastery.create")}
            </Button>
          </Form>
        )}
        {actionData && "errorKey" in actionData && actionData.errorKey ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {t(actionData.errorKey)}
            {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
          </p>
        ) : null}

        {created ? (
          <div className="mt-6">
            <h3 className="font-serif text-lg">{t("path.proposalTitle")}</h3>
            <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("path.proposalLead")}</p>
            <ProposalEditor pathId={created.path.id} proposal={created.proposal} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
