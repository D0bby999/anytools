/**
 * solve.tsx — a worked solution for a typed or photographed problem.
 *
 * The same client shape as chat: the action starts a turn and returns its id,
 * `useTurnStream` attaches to it, and the stages (plan, reason, write) are the
 * server's own stage events. The photo is read from the multipart form HERE,
 * on the server, and forwarded to the API as base64; the browser neither
 * encodes it nor reaches the API.
 *
 * The page renders its own RightPanel for the live progress, as chat does. The
 * app layout still renders its empty one beside it until `main` gains a way
 * for a route to tell the layout it owns the panel (noted in the phase report).
 */
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/solve";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelTurn } from "~/lib/chat.server";
import { listKBs } from "~/lib/kb.server";
import { MAX_IMAGE_BYTES, saveSolutionNote, solutionToQuestion, startSolve } from "~/lib/solve.server";
import { requireUUID } from "~/lib/turns";
import { readOwnVersion, type OwnVersion } from "~/lib/own-version";
import { SOLVE_STAGES } from "~/lib/research-types";
import { useTurnStream } from "~/hooks/use-turn-stream";
import { SolveForm } from "~/components/solve/solve-form";
import { SolutionView, type FollowUpResult } from "~/components/solve/solution-view";
import { StageList } from "~/components/research/stage-list";
import { ToolActivityPanel } from "~/components/chat/tool-activity";
import { RightPanel } from "~/components/layout/right-panel";
import { PageHeader } from "~/components/ui/page-header";
import { DocSection } from "~/components/research/doc-section";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Solve") }, { name: "robots", content: "noindex, nofollow" }];
}

/** Renders its own RightPanel (stages and sources); the layout leaves the slot. */
export const handle = { ownsPanel: true, layout: "page" };

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { knowledge_bases } = await listKBs(user.id);
  return {
    kbs: knowledge_bases.filter((s) => s.ready > 0).map((s) => ({ id: s.kb.id, name: s.kb.name })),
    ownVersionFirst: user.own_version_first === true,
  };
}

type StartResult =
  | { ok: true; turnId: string; sessionId: string }
  | { ok: true; cancelled: true }
  | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<StartResult | FollowUpResult> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "solve");
  const message = (error: unknown, fallback: string) =>
    error instanceof ApiError ? error.message : fallback;

  if (intent === "cancel") {
    try {
      await cancelTurn(user.id, requireUUID(String(form.get("turnId") ?? "")));
      return { ok: true, cancelled: true };
    } catch (error) {
      return { ok: false, error: message(error, "The solve could not be stopped.") };
    }
  }

  if (intent === "note" || intent === "question") {
    const messageId = requireUUID(String(form.get("messageId") ?? ""));
    try {
      if (intent === "note") {
        await saveSolutionNote(user.id, messageId);
        return { ok: true, saved: "note" };
      }
      await solutionToQuestion(user.id, messageId);
      return { ok: true, saved: "question" };
    } catch (error) {
      return { ok: false, error: message(error, "That could not be saved.") };
    }
  }

  const problem = String(form.get("problem") ?? "").trim();
  const photo = form.get("photo");
  let image: { mime_type: string; data: string } | undefined;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is larger than 5 MB." };
    image = {
      mime_type: photo.type,
      data: Buffer.from(await photo.arrayBuffer()).toString("base64"),
    };
  }
  if (problem === "" && !image) return { ok: false, error: "Type a problem or attach a photo of one." };

  const variant = form.get("variant") === "check" ? "check" : "solve";
  const kbId = String(form.get("kb_id") ?? "");
  try {
    const started = await startSolve(user.id, {
      problem,
      image,
      variant,
      user_answer: variant === "check" ? String(form.get("user_answer") ?? "") : undefined,
      kb_ids: kbId ? [requireUUID(kbId)] : undefined,
      own_version: readOwnVersion(form),
    });
    return { ok: true, turnId: started.turn_id, sessionId: started.session_id };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, error: message(error, "The solve could not be started.") };
  }
}

export default function Solve({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("solve");
  const fetcher = useFetcher<StartResult>();
  const canceller = useFetcher<StartResult>();
  const [turnId, setTurnId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The lines this solve was sent with (up-methods phase 11).
  const [sentOwn, setSentOwn] = useState<OwnVersion | undefined>(undefined);
  const stream = useTurnStream(turnId);

  useEffect(() => {
    const data = fetcher.data;
    if (data && data.ok && "turnId" in data) {
      setTurnId(data.turnId);
      setSessionId(data.sessionId);
    }
  }, [fetcher.data]);

  const stop = useCallback(() => {
    if (turnId) canceller.submit({ intent: "cancel", turnId }, { method: "post" });
  }, [canceller, turnId]);

  const busy = turnId !== null && !stream.finished;
  const failure =
    stream.failure?.message ??
    (fetcher.data && !fetcher.data.ok ? fetcher.data.error : null);

  return (
    // A worksheet (P2): h1, lede, "1. The problem" with the form, "2. Worked
    // solution" once there is one; the stages sit in the aside.
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)]">
      <div className="min-w-0 flex-1 px-4 pt-8 pb-24 lg:px-8 lg:pt-12">
        <div className="lp-measure">
          <PageHeader title={t("title")} lede={t("lead")} className="mb-0" />

          <DocSection n={1} title={t("problem.title")}>
            <SolveForm
              fetcher={fetcher}
              kbs={loaderData.kbs}
              busy={busy}
              onStop={stop}
              ownVersionFirst={loaderData.ownVersionFirst}
              onOwnVersion={setSentOwn}
            />
            {failure && (
              <p role="alert" className="mt-4 rounded-lg bg-destructive-soft px-4 py-3 text-sm leading-6">
                {failure}
              </p>
            )}
          </DocSection>

          {turnId && (stream.answer !== "" || stream.finished) && !stream.failure && (
            <SolutionView
              key={turnId}
              text={stream.answer}
              sources={stream.sources}
              streaming={!stream.finished}
              meta={stream.resultMeta}
              sessionId={sessionId}
              ownVersion={sentOwn}
            />
          )}
        </div>
      </div>

      <RightPanel>
        {turnId ? (
          <div className="mt-2 flex flex-col gap-5">
            <StageList
              ns="solve"
              stages={SOLVE_STAGES}
              current={stream.stage}
              done={stream.stagesDone}
              finished={stream.finished}
            />
            <ToolActivityPanel sources={stream.sources} tools={stream.tools} thinking={stream.thinking} stage={stream.stage} />
          </div>
        ) : undefined}
      </RightPanel>
    </div>
  );
}
