/**
 * research.$reportId.tsx — one stored report.
 *
 * The body is exactly what the server stored after validation, so every chip
 * here opens something: a document page (chunk) or the web page it was
 * gathered from (url). The sources list in the right panel is the same set.
 */
import { ArrowLeft } from "lucide-react";
import { Link, redirect, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/research.$reportId";
import { appTitle } from "~/lib/app-title";
import { AudioOverviews } from "~/components/audio/audio-overviews";
import { loadOverviews } from "~/lib/audio.server";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addReportToKnowledge, getReport, saveReportNote } from "~/lib/research.server";
import { listKBs } from "~/lib/kb.server";
import { createSession } from "~/lib/chat.server";
import { requireUUID } from "~/lib/turns";
import { Button } from "~/components/ui/button";
import { CitedBody } from "~/components/research/cited-body";
import { KBOnlyBadge } from "~/components/research/report-list";
import { CitationChip } from "~/components/chat/citation-chip";
import { RightPanel } from "~/components/layout/right-panel";
import { kbOnlyReasonKey } from "~/lib/research-types";
import { ClaimCheck } from "~/components/research/claim-check";
import { KeepStudying, OpenQuestions, type ToKnowledgeResult } from "~/components/research/keep-studying";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { BookMeta } from "~/components/doc/book-meta";
import { AtAGlance } from "~/components/doc/at-a-glance";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Report") }, { name: "robots", content: "noindex, nofollow" }];
}

/** Renders its own RightPanel (the report's sources); the layout leaves the slot. */
export const handle = { ownsPanel: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const reportId = requireUUID(params.reportId);
  try {
    const [report, kbs] = await Promise.all([getReport(user.id, reportId), listKBs(user.id)]);
    // Any knowledge base can take a new document, ready or not.
    return {
      report,
      kbs: kbs.knowledge_bases.map((s) => ({ id: s.kb.id, name: s.kb.name })),
      overviews: await loadOverviews(user.id, { report_id: reportId }),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("not found", { status: 404 });
    }
    throw error;
  }
}

type SaveResult = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: Route.ActionArgs): Promise<SaveResult | ToKnowledgeResult | Response> {
  const { user } = await requireUser(request);
  const reportId = requireUUID(params.reportId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "to-kb") {
    const kbId = requireUUID(String(form.get("kb_id") ?? ""));
    try {
      const [res, kbs] = await Promise.all([
        addReportToKnowledge(user.id, reportId, { kb_id: kbId, include_sources: form.get("include_sources") === "1" }),
        listKBs(user.id),
      ]);
      const kbName = kbs.knowledge_bases.find((s) => s.kb.id === kbId)?.kb.name ?? "";
      return {
        ok: true,
        kbId,
        kbName,
        reportAdded: res.report_added,
        sourcesAdded: res.sources_added,
        sourcesAlready: res.sources_already,
        sourcesFailed: res.sources_failed,
      };
    } catch (error) {
      if (error instanceof Response) throw error;
      return { ok: false, error: error instanceof ApiError ? error.message : "The report could not be added." };
    }
  }

  if (intent === "ask") {
    // A chat on the knowledge base now holding the report.
    const kbId = requireUUID(String(form.get("kb_id") ?? ""));
    const report = await getReport(user.id, reportId);
    const session = await createSession(user.id, {
      title: ("About: " + report.query).slice(0, 120),
      kb_ids: [kbId],
    });
    return redirect(`/chat/${session.id}`);
  }

  try {
    await saveReportNote(user.id, reportId);
    return { ok: true };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, error: error instanceof ApiError ? error.message : "That could not be saved." };
  }
}

export default function ResearchReport({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("research");
  const { report, kbs } = loaderData;
  const save = useFetcher<SaveResult>();
  const saved = report.note_id || (save.data && save.data.ok);

  const words = report.report_md.split(/\s+/).filter(Boolean).length;
  // "At a glance": the claims the check found in their sources, which are
  // the report's conclusions a learner can lean on. Without a check there is
  // nothing to stand behind, so the list is left out rather than guessed.
  const glance =
    report.verification?.status === "checked"
      ? report.verification.claims.filter((c) => c.verdict === "supported").slice(0, 5).map((c) => c.claim)
      : [];

  return (
    // A chapter (P1): h1, book-meta, "At a glance", the report as prose with
    // superscript citations, then "Claim check", open questions and "Keep
    // studying"; the sources are in the aside.
    <article>
      <Link
        to="/research"
        className="inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("report.back")}
      </Link>
      <PageHeader title={report.query} className="mt-2 mb-0" />
      <BookMeta
        label={t("report.meta")}
        items={[
          { label: t("report.sourcesCount", { count: report.sources.length }) },
          { label: t("report.words", { count: words }) },
          { label: <DateText iso={report.created_at} withTime /> },
          { label: `${t("report.mode")}: ${t(`form.${report.mode}`)}` },
          ...(report.kb_only ? [{ label: <KBOnlyBadge reason={report.kb_only_reason} /> }] : []),
        ]}
      />
      {report.kb_only && <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(kbOnlyReasonKey(report.kb_only_reason))}</p>}
      {report.engine === "duckduckgo" && (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("report.engineKeyless")}</p>
      )}

      <div className="lp-doc">
        {glance.length > 0 ? <AtAGlance items={glance} title={t("report.atAGlance")} id="lp-report-glance" /> : null}
        <CitedBody text={report.report_md} sources={report.sources} />
      </div>

      {report.verification && <ClaimCheck check={report.verification} sources={report.sources} />}
      <OpenQuestions questions={report.open_questions ?? []} />
      <KeepStudying kbs={kbs} hasWebSources={report.sources.some((s) => s.kind === "url")} />

      <AudioOverviews overviews={loaderData.overviews} reportId={report.id} />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("report.saved")}
          </p>
        ) : (
          <save.Form method="post">
            <Button type="submit" variant="outline" disabled={save.state !== "idle"}>
              {t("report.save")}
            </Button>
          </save.Form>
        )}
        {save.data && !save.data.ok && (
          <p role="alert" className="text-sm text-destructive">
            {save.data.error}
          </p>
        )}
      </div>

      <RightPanel>
        {report.sources.length === 0 ? (
          <p className="mt-2 lp-empty">{t("report.noSources")}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {report.sources.map((source, i) => (
              <li key={`${source.kind}:${source.id}`}>
                <CitationChip source={source} index={i + 1} variant="entry" />
              </li>
            ))}
          </ol>
        )}
      </RightPanel>
    </article>
  );
}
