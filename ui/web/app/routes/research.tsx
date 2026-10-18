/**
 * research.tsx — ask a question, get a cited report.
 *
 * The same client shape as chat and solve: the action starts a turn, and
 * `useTurnStream` shows the server's stages (rephrase, decompose, gather,
 * synthesize) live in the right panel while the report streams in the page.
 *
 * Whether the web will take part is known BEFORE anything runs: the loader
 * asks the API whether the user has a search key, and the form says "KB-only"
 * in words when they do not. The turn's own observations then say why a given
 * report did not use the web.
 *
 * Like solve, the page renders its own RightPanel; the layout's empty one
 * still renders beside it until `main` lets a route claim the panel.
 */
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/research";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { listSearchConnections } from "~/lib/byok.server";
import { cancelTurn } from "~/lib/chat.server";
import { listKBs } from "~/lib/kb.server";
import { listReports, startResearch } from "~/lib/research.server";
import { requireUUID } from "~/lib/turns";
import { RESEARCH_STAGES } from "~/lib/research-types";
import { useTurnStream } from "~/hooks/use-turn-stream";
import { ResearchForm } from "~/components/research/research-form";
import { LiveReport } from "~/components/research/live-report";
import { ReportList } from "~/components/research/report-list";
import { StageList } from "~/components/research/stage-list";
import { ToolActivityPanel } from "~/components/chat/tool-activity";
import { RightPanel } from "~/components/layout/right-panel";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Research · AnyTools" }, { name: "robots", content: "noindex, nofollow" }];
}

/** Renders its own RightPanel (stages and sources); the layout leaves the slot. */
export const handle = { ownsPanel: true };

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [kbs, search, reports] = await Promise.all([
    listKBs(user.id),
    listSearchConnections(user.id),
    listReports(user.id),
  ]);
  const hasKey = search.search_connections.length > 0;
  const keyless = !hasKey && search.keyless_fallback === true;
  return {
    kbs: kbs.knowledge_bases.filter((s) => s.ready > 0).map((s) => ({ id: s.kb.id, name: s.kb.name })),
    webAvailable: hasKey || keyless,
    webKeyless: keyless,
    // "Research this" on a report's open question lands here with ?q=.
    defaultQuery: (new URL(request.url).searchParams.get("q") ?? "").slice(0, 4000),
    reports: reports.reports,
  };
}

type ActionResult =
  | { ok: true; turnId: string; sessionId: string; webAvailable: boolean }
  | { ok: true; cancelled: true }
  | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const message = (error: unknown, fallback: string) =>
    error instanceof ApiError ? error.message : fallback;

  if (form.get("intent") === "cancel") {
    try {
      await cancelTurn(user.id, requireUUID(String(form.get("turnId") ?? "")));
      return { ok: true, cancelled: true };
    } catch (error) {
      return { ok: false, error: message(error, "The research could not be stopped.") };
    }
  }

  const query = String(form.get("query") ?? "").trim();
  if (query === "") return { ok: false, error: "Write what you want researched." };
  const kbId = String(form.get("kb_id") ?? "");
  try {
    const started = await startResearch(user.id, {
      query,
      mode: form.get("mode") === "deep" ? "deep" : "quick",
      kb_ids: kbId ? [requireUUID(kbId)] : undefined,
      allow_web: form.get("allow_web") === "1",
    });
    return {
      ok: true,
      turnId: started.turn_id,
      sessionId: started.session_id,
      webAvailable: started.web_available === true,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, error: message(error, "The research could not be started.") };
  }
}

export default function Research({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("research");
  const fetcher = useFetcher<ActionResult>();
  const canceller = useFetcher<ActionResult>();
  const [turnId, setTurnId] = useState<string | null>(null);
  const stream = useTurnStream(turnId);

  useEffect(() => {
    const data = fetcher.data;
    if (data && data.ok && "turnId" in data) setTurnId(data.turnId);
  }, [fetcher.data]);

  const stop = useCallback(() => {
    if (turnId) canceller.submit({ intent: "cancel", turnId }, { method: "post" });
  }, [canceller, turnId]);

  const busy = turnId !== null && !stream.finished;
  const failure =
    stream.failure?.message ?? (fetcher.data && !fetcher.data.ok ? fetcher.data.error : null);

  return (
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)] lg:flex-row">
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <div className="lp-measure">
          <div className="lp-prose">
            <h1>{t("title")}</h1>
            <p>{t("lead")}</p>
          </div>

          <div className="mt-8">
            <ResearchForm
              fetcher={fetcher}
              kbs={loaderData.kbs}
              webAvailable={loaderData.webAvailable}
              webKeyless={loaderData.webKeyless}
              defaultQuery={loaderData.defaultQuery}
              busy={busy}
              onStop={stop}
            />
          </div>

          {failure && (
            <p role="alert" className="mt-4 rounded-(--lp-radius-control) bg-destructive-soft px-3 py-2 text-sm leading-prose">
              {failure}
            </p>
          )}

          {turnId && !stream.failure && (stream.answer !== "" || stream.observations.length > 0) && (
            <LiveReport
              key={turnId}
              text={stream.answer}
              sources={stream.sources}
              streaming={!stream.finished}
              observations={stream.observations}
              meta={stream.resultMeta}
            />
          )}

          <ReportList reports={loaderData.reports} />
        </div>
      </div>

      <RightPanel>
        {turnId ? (
          <div className="mt-3 flex flex-col gap-5">
            <StageList
              ns="research"
              stages={RESEARCH_STAGES}
              current={stream.stage}
              done={stream.stagesDone}
              finished={stream.finished}
            />
            <ToolActivityPanel
              sources={stream.sources}
              tools={stream.tools}
              thinking={stream.thinking}
              stage={stream.stage}
            />
          </div>
        ) : undefined}
      </RightPanel>
    </div>
  );
}
