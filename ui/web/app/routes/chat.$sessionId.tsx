/**
 * chat.$sessionId.tsx — one conversation.
 *
 * The shape of this route is the phase's whole client story:
 *
 *  - the loader returns the stored transcript (so a reload shows the answer
 *    that already happened, with no stream at all);
 *  - starting a turn is a fetcher POST that returns a turn id;
 *  - `useTurnStream` attaches to that turn and streams the live one on top.
 *
 * Stored history and live stream are kept SEPARATE in state rather than merged
 * into one list. Merging them means deciding, on every frame, whether the
 * streaming answer has already been persisted — and getting that wrong shows
 * the user the same paragraph twice, which is exactly the acceptance criterion
 * this phase has to meet.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/chat.$sessionId";
import { requireUser, requireUserId } from "~/lib/auth.server";
import {
  answerTurn,
  cancelTurn,
  getMessages,
  getSession,
  startTurn,
  type ChatMessage,
} from "~/lib/chat.server";
import { useTurnStream, type Source } from "~/hooks/use-turn-stream";
import { exchangeOwnVersions, fieldName, readOwnVersion, retellOf, type OwnVersion } from "~/lib/own-version";
import { liveTurnID, requireUUID } from "~/lib/turns";
import { Composer } from "~/components/chat/composer";
import { ContextBar } from "~/components/chat/context-bar";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { ToolActivityPanel } from "~/components/chat/tool-activity";
import { WaitForInputCard } from "~/components/chat/wait-for-input-card";
import { RightPanel } from "~/components/layout/right-panel";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.session.title;
  return [
    { title: title ? `${title} · Chat · AnyTools` : "Chat · AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** This route renders its own panel (sources and stream activity). */
export const handle = { ownsPanel: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  // The user, not only the id: the composer needs their "write my own version
  // first" switch (up-methods phase 11).
  const { userId, user } = await requireUser(request);
  // Validated before it is interpolated into an API path. See requireUUID.
  const sessionId = requireUUID(params.sessionId);

  const [session, history] = await Promise.all([
    getSession(userId, sessionId),
    getMessages(userId, sessionId),
  ]);

  return {
    session,
    messages: history.messages,
    turns: history.turns,
    ownVersionFirst: user.own_version_first === true,
  };
}

type ActionResult =
  | { ok: true; turnId: string }
  | { ok: true; answered: true }
  | { ok: true; cancelled: true }
  | { ok: false; error: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionResult> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "send");

  try {
    if (intent === "cancel") {
      await cancelTurn(userId, requireUUID(String(form.get("turnId") ?? "")));
      return { ok: true, cancelled: true };
    }
    if (intent === "answer") {
      await answerTurn(
        userId,
        requireUUID(String(form.get("turnId") ?? "")),
        String(form.get("answer") ?? ""),
        String(form.get("questionId") ?? "") || undefined,
      );
      return { ok: true, answered: true };
    }
    const { turn_id } = await startTurn(
      userId,
      requireUUID(params.sessionId),
      String(form.get("message") ?? ""),
      readOwnVersion(form),
    );
    return { ok: true, turnId: turn_id };
  } catch (error) {
    // The message is shown to the user, so it has to be the API's own
    // sentence, not a stack trace.
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

export default function ChatSession({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();

  // Seeded from the loader, not from nothing. This is the phase's "refresh
  // mid-stream resumes" criterion: after F5 during a turn the browser has no
  // memory of it, but the server does — the loader already returns the
  // session's turns, and the non-terminal one is the turn to re-attach to. The
  // whole server side supported this; the client simply never asked.
  const [turnId, setTurnId] = useState<string | null>(() => liveTurnID(loaderData.turns));
  // The question the user just asked, shown immediately so the transcript does
  // not appear to swallow it while the turn starts.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // Its own version, shown with it (up-methods phase 11).
  const [pendingOwn, setPendingOwn] = useState<OwnVersion | undefined>(undefined);
  // The finished answer, held until the reloaded transcript contains it.
  //
  // Without this the screen goes through a frame where the stream has ended and
  // the revalidation has not landed, so the question and its answer both blink
  // out and back. A user reads that as "it lost my answer", which is the one
  // impression this product cannot afford.
  const [settled, setSettled] = useState<ChatTurnView[]>([]);
  // The transcript the held copy was captured against. When the loader returns
  // a different one, the revalidation has landed and the held copy is a
  // duplicate.
  const [settledAgainst, setSettledAgainst] = useState<ChatMessage[] | null>(null);

  // Dropped DURING RENDER, not in an effect. An effect runs after the commit,
  // so there is one painted frame in which the reloaded transcript and the held
  // copy are both on screen — the finished answer appears twice. Adjusting state
  // here makes React re-render before painting, which is the documented way to
  // derive state from props that changed.
  if (settled.length > 0 && loaderData.messages !== settledAgainst) {
    setSettled([]);
    setSettledAgainst(null);
  }

  const stream = useTurnStream(turnId);

  // The action's reply carries the new turn id.
  useEffect(() => {
    const data = fetcher.data;
    if (data && data.ok && "turnId" in data) setTurnId(data.turnId);
  }, [fetcher.data]);

  // When the turn ends, reload the transcript so the persisted answer replaces
  // the streamed one, and drop the live turn. Without the reload, a refresh
  // later would be the first time the user saw the stored version.
  useEffect(() => {
    if (!stream.finished || !turnId) return;

    const held: ChatTurnView[] = [];
    if (pendingQuestion !== null) {
      held.push({ id: "settled-user", role: "user", content: pendingQuestion, sources: [], ownVersion: pendingOwn });
    }
    if (stream.answer !== "") {
      held.push({
        id: `settled-${turnId}`,
        role: "assistant",
        content: stream.answer,
        sources: stream.sources,
      });
    }
    setSettled(held);
    setSettledAgainst(loaderData.messages);
    setTurnId(null);
    setPendingQuestion(null);
    setPendingOwn(undefined);
    revalidator.revalidate();
  }, [
    stream.finished,
    stream.answer,
    stream.sources,
    turnId,
    pendingQuestion,
    pendingOwn,
    revalidator,
    loaderData.messages,
  ]);

  const send = useCallback(
    (message: string, ownVersion?: OwnVersion) => {
      setPendingQuestion(message);
      setPendingOwn(ownVersion);
      const fields: Record<string, string> = { intent: "send", message };
      if (ownVersion) {
        fields[fieldName("understanding")] = ownVersion.understanding;
        fields[fieldName("uncertain")] = ownVersion.uncertain;
        fields[fieldName("proof")] = ownVersion.proof;
      }
      fetcher.submit(fields, { method: "post" });
    },
    [fetcher],
  );

  const stop = useCallback(() => {
    if (turnId) fetcher.submit({ intent: "cancel", turnId }, { method: "post" });
  }, [fetcher, turnId]);

  const answer = useCallback(
    (value: string) => {
      if (!turnId) return;
      fetcher.submit(
        {
          intent: "answer",
          turnId,
          answer: value,
          // Echoed back so a retried POST cannot be applied to a later question.
          questionId: stream.question?.id ?? "",
        },
        { method: "post" },
      );
    },
    [fetcher, turnId, stream.question?.id],
  );

  const stored = useMemo(() => toViews(loaderData.messages), [loaderData.messages]);

  // The live turn, if one is running, appended to the stored transcript.
  const live: ChatTurnView[] = [];
  if (pendingQuestion !== null) {
    live.push({ id: "live-user", role: "user", content: pendingQuestion, sources: [], ownVersion: pendingOwn });
  }
  if (turnId && (stream.answer !== "" || stream.tools.length > 0)) {
    live.push({
      id: `live-${turnId}`,
      role: "assistant",
      content: stream.answer,
      sources: stream.sources,
      streaming: !stream.finished,
    });
  }

  const busy = turnId !== null && !stream.finished;
  const lastStoredSources = stored.at(-1)?.sources ?? [];
  const panelSources = stream.sources.length > 0 ? stream.sources : lastStoredSources;

  const failure =
    stream.failure ??
    (fetcher.data && !fetcher.data.ok ? { message: fetcher.data.error } : null);

  return (
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)] lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ContextBar
          title={loaderData.session.title}
          kbCount={loaderData.session.kb_ids.length}
          allowWeb={loaderData.session.allow_web}
        />

        <div className="min-h-0 flex-1 px-4 py-6 lg:px-8">
          <MessageList turns={[...stored, ...settled, ...live]} />

          {stream.question && (
            <div className="mt-6">
              <WaitForInputCard
                question={stream.question}
                onAnswer={answer}
                pending={fetcher.state !== "idle"}
              />
            </div>
          )}

          {failure && (
            <p
              role="alert"
              className="mt-6 max-w-(--lp-measure-read) rounded-(--lp-radius-control) bg-destructive-soft px-3 py-2 text-sm leading-prose"
            >
              {failure.message}
            </p>
          )}
        </div>

        <Composer
          onSend={send}
          onStop={stop}
          busy={busy}
          disabled={fetcher.state === "submitting" && !busy}
          ownVersionFirst={loaderData.ownVersionFirst}
        />
      </div>

      <RightPanel>
        <ToolActivityPanel
          sources={panelSources}
          tools={stream.tools}
          thinking={stream.thinking}
          stage={stream.stage}
        />
        {panelSources.length === 0 && stream.tools.length === 0 && (
          <p className="mt-3 text-sm leading-prose text-muted-foreground">
            {t("panel.sources.empty")}
          </p>
        )}
      </RightPanel>
    </div>
  );
}

/**
 * Turns stored messages into the view model, carrying their saved sources, the
 * learner's own version and an answer's retell (up-methods phase 11).
 */
function toViews(messages: ChatMessage[]): ChatTurnView[] {
  const exchange = exchangeOwnVersions(messages);
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: (m.attachments?.sources ?? []) as Source[],
      capability: m.capability,
      ownVersion: exchange.get(m.id),
      retell: m.role === "assistant" ? retellOf(m.attachments) : undefined,
    }));
}
