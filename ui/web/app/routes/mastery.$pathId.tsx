/**
 * mastery.$pathId.tsx
 * One path: its module map with per-point state, the diagnostic, the open
 * mistakes, and — until a plan is approved — the proposal editor.
 *
 * Actions here are intents on one path: propose, approve, diagnostic, archive.
 * `approve` is also the target of ProposalEditor on the index page.
 */
import { Link, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/mastery.$pathId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  approvePath,
  archivePath,
  getPath,
  openErrors,
  proposePath,
  runDiagnostic,
} from "~/lib/mastery.server";
import { percent, type Proposal, type QuestionView } from "~/lib/study-types";
import { parseApproval } from "~/lib/mastery-form";
import { Button } from "~/components/ui/button";
import { ProposalEditor } from "~/components/mastery/proposal-editor";
import { QuestionCard } from "~/components/quiz/question-card";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.detail ? `${data.detail.path.goal} · AnyTools` : "Mastery · AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    const [detail, errors] = await Promise.all([
      getPath(user.id, params.pathId),
      openErrors(user.id, params.pathId),
    ]);
    return { detail, errors: errors.errors };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const pathId = params.pathId;

  try {
    switch (intent) {
      case "propose":
        return { proposal: await proposePath(user.id, pathId) };
      case "approve": {
        const modules = parseApproval(form);
        if (modules.length === 0) return { errorKey: "errors.emptyPlan", errorDetail: "" };
        await approvePath(user.id, pathId, modules);
        return redirect(`/mastery/${pathId}`);
      }
      case "diagnostic":
        return { diagnostic: (await runDiagnostic(user.id, pathId)).questions };
      case "archive":
        await archivePath(user.id, pathId);
        return redirect("/mastery");
    }
  } catch (error) {
    return { errorKey: "errors.pathActionFailed", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return null;
}

type ActionData = {
  proposal?: Proposal;
  diagnostic?: QuestionView[];
  errorKey?: string;
  errorDetail?: string;
} | null;

export default function MasteryPath({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const { detail, errors } = loaderData;
  const fetcher = useFetcher<ActionData>();
  const planned = detail.modules.length > 0;
  const busy = fetcher.state !== "idle";

  return (
    <div className="lp-measure">
      <Link
        to="/mastery"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("path.back")}
      </Link>

      <PageHeader
        title={detail.path.goal}
        className="mt-2 mb-0"
        lede={
          <>
            {detail.kb_name}
            {planned ? ` · ${t("path.overall", { mastery: percent(detail.mastery), due: detail.due_count })}` : ""}
          </>
        }
      />

      {planned ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild>
            <Link to={`/mastery/${detail.path.id}/session`}>{t("path.study")}</Link>
          </Button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="diagnostic" />
            <Button type="submit" variant="outline" disabled={busy}>
              {t("path.diagnostic")}
            </Button>
          </fetcher.Form>
        </div>
      ) : (
        <section aria-labelledby="lp-path-plan" className="mt-8">
          <h2 id="lp-path-plan" className="lp-section">
            {t("path.proposalTitle")}
          </h2>
          {fetcher.data?.proposal ? (
            <ProposalEditor pathId={detail.path.id} proposal={fetcher.data.proposal} />
          ) : (
            <>
                <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("path.unplanned")}</p>
                <fetcher.Form method="post" className="mt-3">
                  <input type="hidden" name="intent" value="propose" />
                  <Button type="submit" disabled={busy}>
                    {busy ? t("mastery.planning") : t("path.propose")}
                  </Button>
                </fetcher.Form>
            </>
          )}
        </section>
      )}

      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(fetcher.data.errorKey)}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}

      {fetcher.data?.diagnostic ? (
        <section aria-labelledby="lp-path-diagnostic" className="mt-8">
          <h2 id="lp-path-diagnostic" className="lp-section">
            {t("path.diagnostic")}
          </h2>
          <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("path.diagnosticLead")}</p>
          <ol className="mt-4 space-y-4">
            {fetcher.data.diagnostic.map((q) => (
              <li key={q.id}>
                <QuestionCard question={q} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {planned ? (
        <section aria-labelledby="lp-path-modules" className="mt-10">
          <h2 id="lp-path-modules" className="lp-section">
            {t("path.modules")}
          </h2>
          {detail.explain_gate ? (
            <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("path.explainGate")}</p>
          ) : null}
          <ol className="mt-3 space-y-6">
            {detail.modules.map((m) => (
              <li key={m.module.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-sans text-base font-medium">{m.module.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {m.graduated
                      ? t("path.graduated")
                      : t("path.moduleState", {
                          mastery: percent(m.mastery),
                          threshold: percent(m.module.pass_threshold),
                        })}
                  </p>
                </div>
                {m.module.objective ? (
                  <p className="mt-1 text-sm leading-prose text-muted-foreground">{m.module.objective}</p>
                ) : null}
                <ul className="mt-2 border-t">
                  {m.knowledge_points.map((kp) => (
                    <li
                      key={kp.knowledge_point.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2.5 text-sm"
                    >
                      <span>{kp.knowledge_point.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {kp.state.explain_passed_at ? (
                          <span className="mr-2 font-medium text-primary">{t("path.explained")}</span>
                        ) : null}
                        {kp.due ? <span className="mr-2 font-medium text-warning">{t("path.dueNow")}</span> : null}
                        {t("path.pointState", {
                          mastery: percent(kp.state.mastery_estimate),
                          reviews: kp.state.reviews,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="lp-path-errors" className="mt-10">
        <h2 id="lp-path-errors" className="lp-section">
          {t("path.errors")}
        </h2>
        {errors.length === 0 ? (
          <p className="mt-3 lp-empty">{t("path.noErrors")}</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              <Link
                to={`/quiz/practice?path=${encodeURIComponent(detail.path.id)}`}
                className="text-primary underline underline-offset-4"
              >
                {t("path.practise")}
              </Link>
            </p>
            <ul className="mt-3 border-t">
              {errors.map((e) => (
                <li key={e.id} className="border-b py-3 text-sm">
                  <p className="leading-snug">{e.prompt}</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    {e.knowledge_point_name} · {t("path.errorMeta", { type: e.error_type, retries: e.retries })}
                    {e.self_attribution ? ` · ${t("path.yourRead", { read: e.self_attribution })}` : ""}
                    {e.ai_confirmation ? ` · ${e.ai_confirmation}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="lp-path-archive" className="mt-12 border-t pt-6">
        <h2 id="lp-path-archive" className="sr-only">
          {t("path.archive")}
        </h2>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="archive" />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(event) => {
              if (!window.confirm(t("path.archiveConfirm"))) event.preventDefault();
            }}
          >
            {t("path.archive")}
          </Button>
        </fetcher.Form>
      </section>
    </div>
  );
}
