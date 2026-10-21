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
 *
 * On top of that (plan 261019-1015, after postclaw's chat surface): the end of
 * the conversation can be asked again or edited (a rewind), messages typed
 * while a turn runs wait in a queue, the page follows the stream unless the
 * learner scrolls away, and the conversation can be pinned to one of the
 * learner's chat connections.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown } from "lucide-react";
import type { Route } from "./+types/chat.$sessionId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser, requireUserId } from "~/lib/auth.server";
import {
  answerTurn,
  cancelTurn,
  getMessages,
  getSession,
  listFeedback,
  listSessions,
  patchSession,
  startTurn,
  type ChatMessage,
} from "~/lib/chat.server";
import { listConnections, listRoutes } from "~/lib/byok.server";
import { useTurnStream, type Source } from "~/hooks/use-turn-stream";
import { useFollowScroll } from "~/hooks/use-follow-scroll";
import { useChatFeedback } from "~/hooks/use-chat-feedback";
import { useChatSearch } from "~/hooks/use-chat-search";
import { FoldsProvider } from "~/components/chat/folds";
import { RECENT_LIMIT, setLiveConversation } from "~/components/chat/recent-conversations";
import { SearchBar } from "~/components/chat/search-bar";
import { exchangeOwnVersions, fieldName, readOwnVersion, retellOf, type OwnVersion } from "~/lib/own-version";
import { liveWork, readFollowUps, readWork } from "~/lib/chat-work";
import { liveTurnID, requireUUID } from "~/lib/turns";
import { Composer, modelKey, type ModelOption } from "~/components/chat/composer";
import { ContextBar } from "~/components/chat/context-bar";
import { Starters } from "~/components/chat/follow-ups";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { ToolActivityPanel } from "~/components/chat/tool-activity";
import { WaitForInputCard } from "~/components/chat/wait-for-input-card";
import { RightPanel } from "~/components/layout/right-panel";
import { Button } from "~/components/ui/button";
import { listKBs } from "~/lib/kb.server";

export function meta({ data, matches }: Route.MetaArgs) {
  const title = data?.session.title;
  return [
    { title: title ? appTitle(matches, raw(title), "Chat") : appTitle(matches, "Chat") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/**
 * Starting, answering or stopping a turn does not reload the transcript: the
 * question is already on screen as the pending one, and a reload landing
 * mid-turn would show it twice. The route re-reads once the turn has ended
 * (the settle effect below). Other intents (knowledge bases, the model pin)
 * change the session and reload as usual.
 */
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const intent = formData?.get("intent");
  if (intent === "send" || intent === "answer" || intent === "cancel") return false;
  return defaultShouldRevalidate;
}

/** This route renders its own panel (sources and stream activity). */
export const handle = { ownsPanel: true, layout: "page" };

export async function loader({ request, params }: Route.LoaderArgs) {
  // The user, not only the id: the composer needs their "write my own version
  // first" switch (up-methods phase 11).
  const { userId, user } = await requireUser(request);
  // Validated before it is interpolated into an API path. See requireUUID.
  const sessionId = requireUUID(params.sessionId);

  const [session, history, kbs, models, recent, feedback] = await Promise.all([
    getSession(userId, sessionId),
    getMessages(userId, sessionId),
    listKBs(userId).catch(() => ({ knowledge_bases: [] })),
    chatModels(userId),
    // The sidebar's rows under Chat, and the answers' ratings: either one
    // failing costs its own part, never the page.
    listSessions(userId, "", RECENT_LIMIT).catch(() => ({ sessions: [] })),
    listFeedback(userId, sessionId).catch(() => ({ feedback: [] })),
  ]);

  return {
    session,
    messages: history.messages,
    turns: history.turns,
    ownVersionFirst: user.own_version_first === true,
    kbs: kbs.knowledge_bases.map((k) => ({ id: k.kb.id, name: k.kb.name })),
    models,
    chatRecent: recent.sessions.map((s) => ({ id: s.id, title: s.title, running: s.running })),
    feedback: feedback.feedback,
  };
}

/**
 * The connections on the learner's chat route, in route order, named as they
 * named them. A failure reads as "no choice to offer", never as a broken page.
 */
async function chatModels(userId: string): Promise<ModelOption[]> {
  try {
    const [routes, conns] = await Promise.all([listRoutes(userId), listConnections(userId)]);
    const names = new Map(conns.connections.map((c) => [c.id, c.name]));
    return (routes.routes.chat ?? []).flatMap((e) => {
      const name = names.get(e.connection_id);
      return name ? [{ id: e.connection_id, name, model: e.model }] : [];
    });
  } catch {
    return [];
  }
}

type ActionResult =
  | { ok: true; turnId: string }
  | { ok: true; answered: true }
  | { ok: true; cancelled: true }
  | { ok: true; attached: true }
  | { ok: true; pinned: true }
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
    if (intent === "kbs") {
      const kbIds = form.getAll("kb_id").map((v) => requireUUID(String(v)));
      await patchSession(userId, requireUUID(params.sessionId), { kb_ids: kbIds });
      return { ok: true, attached: true };
    }
    if (intent === "model") {
      // "<connection id>::<model>", or "" for the route's own order.
      const [id = "", model = ""] = String(form.get("entry") ?? "").split("::");
      await patchSession(
        userId,
        requireUUID(params.sessionId),
        id === "" ? { connection_id: "" } : { connection_id: requireUUID(id), model_hint: model },
      );
      return { ok: true, pinned: true };
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
    const rewind = String(form.get("rewind_to_id") ?? "");
    const { turn_id } = await startTurn(
      userId,
      requireUUID(params.sessionId),
      String(form.get("message") ?? ""),
      readOwnVersion(form),
      rewind === "" ? undefined : requireUUID(rewind),
    );
    return { ok: true, turnId: turn_id };
  } catch (error) {
    // The message is shown to the user, so it has to be the API's own
    // sentence, not a stack trace.
    return { ok: false, error: error instanceof Error ? error.message : "unknown error" };
  }
}

export default function ChatSession(props: Route.ComponentProps) {
  // The folds are shared by the transcript, its search and "Expand all"; a
  // new conversation starts with its own.
  return (
    <FoldsProvider key={props.loaderData.session.id}>
      <Conversation {...props} />
    </FoldsProvider>
  );
}

function Conversation({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  const sessionId = loaderData.session.id;

  const [turnId, setTurnId] = useState<string | null>(() => liveTurnID(loaderData.turns));
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingOwn, setPendingOwn] = useState<OwnVersion | undefined>(undefined);
  const [settled, setSettled] = useState<ChatTurnView[]>([]);
  const [settledAgainst, setSettledAgainst] = useState<ChatMessage[] | null>(null);
  // A rewind hides the stored messages from that question on until the
  // loader, re-read after the turn, no longer has them.
  const [cutFrom, setCutFrom] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  // Settled views were held only until the loader caught up with them; once
  // it has, the stored transcript is the truth again.
  if ((settled.length > 0 || cutFrom !== null) && loaderData.messages !== settledAgainst) {
    if (settledAgainst !== null) {
      setSettled([]);
      setSettledAgainst(null);
      setCutFrom(null);
    }
  }

  const stream = useTurnStream(turnId);
  const queue = useQueue(sessionId);
  const feedback = useChatFeedback(loaderData.feedback);
  const transcript = useRef<HTMLDivElement>(null);
  // Said once per answer to a screen reader; a stop and a failure have their
  // own status and alert below.
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    const data = fetcher.data;
    if (data && data.ok && "turnId" in data) setTurnId(data.turnId);
  }, [fetcher.data]);

  // A send the server refused (a turn already running, a dropped connection)
  // leaves the question on screen as pending, with the error and a Retry that
  // sends it again.
  const sendRefused = !!fetcher.data && !fetcher.data.ok && turnId === null && pendingQuestion !== null;

  useEffect(() => {
    if (!stream.finished || !turnId) return;

    const held: ChatTurnView[] = [];
    if (pendingQuestion !== null) {
      held.push({ id: "settled-user", role: "user", content: pendingQuestion, sources: [], ownVersion: pendingOwn });
    }
    if (stream.answer !== "" && !stream.failure) {
      held.push({
        id: `settled-${turnId}`,
        role: "assistant",
        content: stream.answer,
        sources: stream.sources,
        work: readWork(stream.resultMeta?.work) ?? liveWork(stream.tools),
      });
    }
    setSettled(held);
    setSettledAgainst(loaderData.messages);
    setTurnId(null);
    setPendingQuestion(null);
    setPendingOwn(undefined);
    setStopped(stream.cancelled);
    if (!stream.failure) setAnnounced(t("chat.answerReady"));
    // Queued messages wait while something is wrong; the learner resumes them.
    if (stream.failure && queue.items.length > 0) queue.pause();
    revalidator.revalidate();
  }, [
    stream.finished,
    stream.answer,
    stream.sources,
    stream.failure,
    stream.cancelled,
    stream.resultMeta,
    stream.tools,
    turnId,
    pendingQuestion,
    pendingOwn,
    revalidator,
    loaderData.messages,
    queue,
    t,
  ]);

  const submitTurn = useCallback(
    (message: string, ownVersion?: OwnVersion, rewindToId?: string) => {
      setPendingQuestion(message);
      setPendingOwn(ownVersion);
      setStopped(false);
      const fields: Record<string, string> = { intent: "send", message };
      if (ownVersion) {
        fields[fieldName("understanding")] = ownVersion.understanding;
        fields[fieldName("uncertain")] = ownVersion.uncertain;
        fields[fieldName("proof")] = ownVersion.proof;
      }
      if (rewindToId) {
        fields.rewind_to_id = rewindToId;
        setCutFrom(rewindToId);
        setSettled([]);
        setSettledAgainst(loaderData.messages);
      }
      fetcher.submit(fields, { method: "post" });
    },
    [fetcher, loaderData.messages],
  );

  const send = useCallback((message: string, ownVersion?: OwnVersion) => submitTurn(message, ownVersion), [submitTurn]);

  const stored = useMemo(() => toViews(loaderData.messages), [loaderData.messages]);
  const lastQuestion = [...stored].reverse().find((m) => m.role === "user");

  const regenerate = useCallback(
    (questionId: string) => {
      const q = stored.find((m) => m.id === questionId);
      if (q) submitTurn(q.content, q.ownVersion, questionId);
    },
    [stored, submitTurn],
  );
  const edit = useCallback((questionId: string, text: string) => submitTurn(text, undefined, questionId), [submitTurn]);

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
          questionId: stream.question?.id ?? "",
        },
        { method: "post" },
      );
    },
    [fetcher, turnId, stream.question?.id],
  );

  const pinModel = useCallback(
    (entry: string) => fetcher.submit({ intent: "model", entry }, { method: "post" }),
    [fetcher],
  );

  const busy = turnId !== null && !stream.finished;
  const starting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "send";

  // The sidebar's dot for this conversation follows the stream.
  useEffect(() => {
    setLiveConversation(busy || starting ? sessionId : null);
  }, [busy, starting, sessionId]);
  useEffect(() => () => setLiveConversation(null), []);

  // Drain the queue: the next message goes once the turn before it has
  // finished well and nothing else is in flight. The pause gives the server a
  // moment to release the finished turn.
  useEffect(() => {
    if (busy || starting || queue.paused || queue.items.length === 0 || fetcher.state !== "idle") return;
    const id = window.setTimeout(() => {
      const next = queue.shift();
      if (next) send(next);
    }, 600);
    return () => window.clearTimeout(id);
  }, [busy, starting, queue, fetcher.state, send]);

  const shown = cutFrom ? stored.slice(0, Math.max(0, stored.findIndex((m) => m.id === cutFrom))) : stored;
  const live: ChatTurnView[] = [];
  if (pendingQuestion !== null) {
    live.push({ id: "live-user", role: "user", content: pendingQuestion, sources: [], ownVersion: pendingOwn });
  }
  if (turnId && (stream.answer !== "" || stream.tools.length > 0 || stream.compacted > 0 || stream.thinking !== "")) {
    live.push({
      id: `live-${turnId}`,
      role: "assistant",
      content: stream.answer,
      sources: stream.sources,
      streaming: !stream.finished,
      work: { ...liveWork(stream.tools), summarised: stream.compacted || undefined },
      thinking: stream.thinking || undefined,
    });
  }
  const turns = [...shown, ...settled, ...live];

  const lastStoredSources = stored.at(-1)?.sources ?? [];
  const panelSources = stream.sources.length > 0 ? stream.sources : lastStoredSources;

  const failure =
    stream.failure && !stream.cancelled
      ? stream.failure
      : fetcher.data && !fetcher.data.ok
        ? { message: fetcher.data.error, retryable: false }
        : null;

  const contentKey = `${turns.length}:${stream.answer.length}:${stream.tools.length}`;
  const { away, jump } = useFollowScroll(contentKey);
  const search = useChatSearch(transcript, contentKey);

  const attachedNames = loaderData.kbs.filter((k) => loaderData.session.kb_ids.includes(k.id)).map((k) => k.name);

  return (
    // Read as a chapter (P1, `layout: page`): one 780 column with the title
    // and what it reads, the transcript, and the composer stuck to the bottom
    // of the scroll region. The sources sit in the aside from 1280.
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)]">
      <div className="mx-auto flex min-h-0 w-full max-w-(--lp-measure-read) flex-1 flex-col px-4 pt-8 lg:px-8 lg:pt-12 xl:px-0">
        <SearchBar search={search} className="sticky top-2 z-20 mb-4" />
        <p role="status" className="sr-only">
          {announced}
        </p>
        <ContextBar
          title={loaderData.session.title}
          kbs={loaderData.kbs}
          attached={loaderData.session.kb_ids}
          allowWeb={loaderData.session.allow_web}
        />

        <div ref={transcript} className="min-h-0 flex-1 pb-8">
          <MessageList
            turns={turns}
            actions={{
              busy: busy || starting,
              onRegenerate: regenerate,
              onEdit: edit,
              onFollowUp: send,
              feedback,
            }}
          />

          {turns.length === 0 && !busy && !starting ? (
            <Starters kbNames={attachedNames} onPick={send} />
          ) : null}

          {stream.question && (
            <div className="mt-6">
              <WaitForInputCard
                question={stream.question}
                onAnswer={answer}
                pending={fetcher.state !== "idle"}
              />
            </div>
          )}

          {stopped && !busy ? (
            <p role="status" className="mt-4 text-sm leading-6 text-muted-foreground">
              {t("chat.stopped")}
            </p>
          ) : null}

          {failure && !busy && (
            <div
              role="alert"
              className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-sm leading-6"
            >
              <span className="min-w-0 flex-1">{failure.message}</span>
              {sendRefused && pendingQuestion !== null && !starting ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => submitTurn(pendingQuestion, pendingOwn, cutFrom ?? undefined)}
                >
                  {t("chat.retry")}
                </Button>
              ) : lastQuestion && !starting ? (
                <Button type="button" size="sm" variant="outline" onClick={() => regenerate(lastQuestion.id)}>
                  {t("chat.retry")}
                </Button>
              ) : null}
            </div>
          )}

          {queue.paused && queue.items.length > 0 && !busy ? (
            <div role="status" className="mt-4 flex flex-wrap items-center gap-3 text-sm leading-6">
              <span className="text-muted-foreground">{t("chat.queue.paused", { count: queue.items.length })}</span>
              <Button type="button" size="sm" variant="outline" onClick={queue.resume}>
                {t("chat.queue.resume")}
              </Button>
            </div>
          ) : null}
        </div>

        {/* Stuck to the bottom of the one scroll region. The phone bar it
            used to clear is gone with the up shell, and the region ends at
            the viewport's dynamic height, so an open on-screen keyboard
            shrinks the region rather than covering the composer. */}
        <div className="sticky bottom-0 z-10">
          {away ? (
            // Only while the learner has scrolled away from the answer being
            // written (useFollowScroll): a secondary button floating at the
            // middle of the bottom edge, just above the composer.
            <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
              <Button type="button" size="sm" variant="outline" className="pointer-events-auto rounded-full bg-card" onClick={jump}>
                <ArrowDown aria-hidden="true" />
                {t("chat.jumpToLatest")}
              </Button>
            </div>
          ) : null}
          <Composer
            onSend={send}
            onStop={stop}
            busy={busy}
            disabled={starting && !busy}
            ownVersionFirst={loaderData.ownVersionFirst}
            draftKey={`anytools.chat.draft.${sessionId}`}
            queued={queue.items}
            onQueue={queue.push}
            onUnqueue={queue.remove}
            models={loaderData.models}
            model={
              loaderData.session.connection_id
                ? modelKey({ id: loaderData.session.connection_id, model: loaderData.session.model_hint ?? "" })
                : ""
            }
            onModel={pinModel}
          />
        </div>
      </div>

      {/* "Sources" in the aside, in place of an outline: the latest answer's
          passages as a dated-list line each (number · document — page), the
          numbers matching the superscripts in the answer. Tool steps and the
          reasoning are in the answer's process row (postclaw's grouped work);
          the panel keeps the sources. */}
      <RightPanel title={t("chat.sources")}>
        <ToolActivityPanel sources={panelSources} tools={[]} thinking="" stage={null} />
        {panelSources.length === 0 && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("panel.sources.empty")}</p>
        )}
      </RightPanel>
    </div>
  );
}

/**
 * Messages typed while a turn runs, kept for this tab in sessionStorage: a
 * reload keeps them, another tab does not see them, and nothing is stored on
 * the server. `paused` is set when a turn fails or is stopped.
 */
function useQueue(sessionId: string) {
  const key = `anytools.chat.queue.${sessionId}`;
  const [items, setItems] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
      if (Array.isArray(saved)) setItems(saved.filter((x): x is string => typeof x === "string"));
    } catch {
      // Nothing usable stored.
    }
  }, [key]);

  const save = useCallback(
    (next: string[]) => {
      setItems(next);
      try {
        if (next.length === 0) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage refused: the queue still works for this page.
      }
    },
    [key],
  );

  return useMemo(
    () => ({
      items,
      paused,
      push: (m: string) => save([...items, m]),
      remove: (i: number) => save(items.filter((_, j) => j !== i)),
      shift: () => {
        const [first, ...rest] = items;
        save(rest);
        return first;
      },
      pause: () => setPaused(true),
      resume: () => setPaused(false),
    }),
    [items, paused, save],
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
      work: m.role === "assistant" ? readWork(m.attachments?.work) : undefined,
      followUps: m.role === "assistant" ? readFollowUps(m.attachments?.suggestions) : undefined,
      incomplete: m.role === "assistant" && m.attachments?.incomplete === true,
    }));
}
