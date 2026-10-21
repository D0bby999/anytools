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
import { ApiError, apiFetch } from "~/lib/api.server";
import { MAX_IMAGE_BYTES, startSolve } from "~/lib/solve.server";
import { startResearch } from "~/lib/research.server";
import { listDocuments } from "~/lib/kb.server";
import { planSend } from "~/lib/chat-slash";
import { decideShortcut } from "~/lib/chat-shortcuts";
import { ShortcutHelpDialog } from "~/components/chat/shortcut-help-dialog";
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
import { Composer, modelKey, type ModelOption, type Reference, type SendExtra } from "~/components/chat/composer";
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
  if (intent === "send" || intent === "solve" || intent === "research" || intent === "answer" || intent === "cancel") return false;
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
    documents: await attachedDocuments(userId, session.kb_ids),
    messages: history.messages,
    turns: history.turns,
    ownVersionFirst: user.own_version_first === true,
    kbs: kbs.knowledge_bases.map((k) => ({ id: k.kb.id, name: k.kb.name })),
    models,
    chatRecent: recent.sessions.map((s) => ({ id: s.id, title: s.title, running: s.running })),
    feedback: feedback.feedback,
  };
}

/** The most documents the `@` menu is given. */
const MAX_DOCUMENTS = 300;

/**
 * The documents of the knowledge bases this conversation reads, for `@`. A
 * knowledge base that cannot be listed costs its own documents, not the page.
 */
async function attachedDocuments(userId: string, kbIds: string[]): Promise<Reference[]> {
  const lists = await Promise.all(kbIds.map((id) => listDocuments(userId, id).catch(() => ({ documents: [] }))));
  return lists
    .flatMap((l) => l.documents)
    .slice(0, MAX_DOCUMENTS)
    .map((d) => ({ id: d.id, title: d.title }));
}

/**
 * The connections on the learner's chat route, in route order, named as they
 * named them. A failure reads as "no choice to offer", never as a broken page.
 */
/** Failures said in the learner's language rather than the API's English. */
const FAILURE_CODES = new Set(["PROVIDER_STALLED", "SAFETY_STOP", "TOOL_ROUND_LIMIT", "TOKEN_BUDGET"]);

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
  | { ok: true; drawn: true }
  | { ok: false; error: string; intent?: string };

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
    const sessionId = requireUUID(params.sessionId);
    if (intent === "solve") {
      // `/solve`, or a photo: Solve on this conversation, streamed like chat.
      const problem = String(form.get("message") ?? "").trim();
      const photo = form.get("photo");
      let image: { mime_type: string; data: string } | undefined;
      if (photo instanceof File && photo.size > 0) {
        if (photo.size > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is larger than 5 MB.", intent };
        image = { mime_type: photo.type || "image/jpeg", data: Buffer.from(await photo.arrayBuffer()).toString("base64") };
      }
      if (problem === "" && !image) return { ok: false, error: "Type a problem or attach a photo of one.", intent };
      const started = await startSolve(userId, { session_id: sessionId, problem, image, own_version: readOwnVersion(form) });
      return { ok: true, turnId: started.turn_id };
    }
    if (intent === "research") {
      const query = String(form.get("message") ?? "").trim();
      if (query === "") return { ok: false, error: "Say what to research after /research.", intent };
      const started = await startResearch(userId, { session_id: sessionId, query, mode: "quick" });
      return { ok: true, turnId: started.turn_id };
    }
    if (intent === "draw") {
      // `/draw`: the latest answer, drawn; the reload shows the diagram.
      await apiFetch("/v1/visualize", userId, {
        method: "POST",
        body: { message_id: requireUUID(String(form.get("messageId") ?? "")), request: String(form.get("message") ?? "") },
      });
      return { ok: true, drawn: true };
    }
    const rewind = String(form.get("rewind_to_id") ?? "");
    const askWith = String(form.get("connection_id") ?? "");
    const { turn_id } = await startTurn(
      userId,
      sessionId,
      String(form.get("message") ?? ""),
      readOwnVersion(form),
      rewind === "" ? undefined : requireUUID(rewind),
      form.getAll("reference").map((v) => requireUUID(String(v))),
      askWith === "" ? undefined : { connectionId: requireUUID(askWith), model: String(form.get("model") ?? "") },
    );
    return { ok: true, turnId: turn_id };
  } catch (error) {
    // The message is shown to the user, so it has to be the API's own
    // sentence, not a stack trace.
    const message = error instanceof ApiError || error instanceof Error ? error.message : "unknown error";
    return { ok: false, error: message, intent };
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
  const [failed, setFailed] = useState<{ message: string; code?: string; retryable?: boolean } | null>(null);

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
    // Settling resets the stream, and its failure with it: keep the failure
    // on screen, with its Try again, until the next question.
    setFailed(stream.failure && !stream.cancelled ? stream.failure : null);
    if (!stream.failure) setAnnounced(t("chat.answerReady"));
    // Queued messages wait while something is wrong; the learner resumes them.
    if (stream.failure && queue.items.length > 0) queue.pause(stream.cancelled ? "stopped" : "failed");
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
    (
      message: string,
      ownVersion?: OwnVersion,
      rewindToId?: string,
      opts: { intent?: "send" | "solve" | "research"; references?: Reference[]; photo?: File; model?: ModelOption } = {},
    ) => {
      setPendingQuestion(message || (opts.photo ? t("chat.attach.photoQuestion") : ""));
      setPendingOwn(ownVersion);
      setStopped(false);
      setFailed(null);
      const form = new FormData();
      form.set("intent", opts.intent ?? "send");
      form.set("message", message);
      if (ownVersion) {
        form.set(fieldName("understanding"), ownVersion.understanding);
        form.set(fieldName("uncertain"), ownVersion.uncertain);
        form.set(fieldName("proof"), ownVersion.proof);
      }
      for (const r of opts.references ?? []) form.append("reference", r.id);
      if (opts.photo) form.set("photo", opts.photo, opts.photo.name);
      if (opts.model) {
        form.set("connection_id", opts.model.id);
        form.set("model", opts.model.model);
      }
      if (rewindToId) {
        form.set("rewind_to_id", rewindToId);
        setCutFrom(rewindToId);
        setSettled([]);
        setSettledAgainst(loaderData.messages);
      }
      void fetcher.submit(form, { method: "post", encType: opts.photo ? "multipart/form-data" : "application/x-www-form-urlencoded" });
    },
    [fetcher, loaderData.messages, t],
  );

  const stored = useMemo(() => toViews(loaderData.messages), [loaderData.messages]);
  const lastQuestion = [...stored].reverse().find((m) => m.role === "user");
  const lastAnswer = [...stored].reverse().find((m) => m.role === "assistant" && m.capability !== "visualize");

  // A message as typed: a `/` command becomes what it stands for (a written
  // request, Solve, Research or a drawing); a photo goes to Solve.
  const send = useCallback(
    (message: string, ownVersion?: OwnVersion, extra: SendExtra = {}) => {
      const plan = planSend(message, !!extra.photo, (id, topic) =>
        t(`chat.slash.command.${id}.template`, { topic: topic || t("chat.slash.topicDefault") }),
      );
      if (plan.intent === "draw") {
        if (lastAnswer) void fetcher.submit({ intent: "draw", messageId: lastAnswer.id, message: plan.text }, { method: "post" });
        return;
      }
      if (plan.intent === "solve") submitTurn(plan.text, ownVersion, undefined, { intent: "solve", photo: extra.photo });
      else if (plan.intent === "research") submitTurn(plan.text, ownVersion, undefined, { intent: "research" });
      else submitTurn(plan.text, ownVersion, undefined, { references: extra.references });
    },
    [submitTurn, fetcher, lastAnswer, t],
  );

  const regenerate = useCallback(
    (questionId: string) => {
      const q = stored.find((m) => m.id === questionId);
      if (q) submitTurn(q.content, q.ownVersion, questionId);
    },
    [stored, submitTurn],
  );
  // Once, with another model on the route; the conversation keeps its pick.
  const regenerateWith = useCallback(
    (questionId: string, model: ModelOption) => {
      const q = stored.find((m) => m.id === questionId);
      if (q) submitTurn(q.content, q.ownVersion, questionId, { model });
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
  const submitting = fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : "";
  const starting = submitting === "send" || submitting === "solve" || submitting === "research";

  // The model chip: the pick shows while it is saved; a refusal falls back
  // to what the conversation uses, and says so.
  const pinned = loaderData.session.connection_id
    ? modelKey({ id: loaderData.session.connection_id, model: loaderData.session.model_hint ?? "" })
    : "";
  const modelPending = submitting === "model";
  const modelShown = modelPending ? String(fetcher.formData?.get("entry") ?? "") : pinned;
  const modelFailed = fetcher.state === "idle" && !!fetcher.data && !fetcher.data.ok && fetcher.data.intent === "model";

  // How full the window was: the answer being written, else the last one.
  const contextWork = readWork(stream.resultMeta?.work) ?? [...stored].reverse().find((m) => m.work?.contextWindow)?.work;
  const context =
    contextWork?.contextTokens && contextWork.contextWindow
      ? {
          used: contextWork.contextTokens,
          window: contextWork.contextWindow,
          budget: contextWork.historyBudget,
          cached: contextWork.cachedTokens,
        }
      : null;

  // The knowledge base an attached file goes to: the first this
  // conversation reads.
  const firstKB = loaderData.kbs.find((k) => loaderData.session.kb_ids.includes(k.id)) ?? null;

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
      work: { ...liveWork(stream.tools), summarised: stream.compacted || undefined, stoppedLoop: stream.loopStopped || undefined },
      thinking: stream.thinking || undefined,
    });
  }
  const turns = [...shown, ...settled, ...live];

  const lastStoredSources = stored.at(-1)?.sources ?? [];
  const panelSources = stream.sources.length > 0 ? stream.sources : lastStoredSources;

  const failure =
    stream.failure && !stream.cancelled
      ? stream.failure
      : failed
        ? failed
        : fetcher.data && !fetcher.data.ok && fetcher.data.intent !== "model"
        ? { message: fetcher.data.error, retryable: false }
        : null;

  const contentKey = `${turns.length}:${stream.answer.length}:${stream.tools.length}`;
  const { away, jump } = useFollowScroll(contentKey);
  const search = useChatSearch(transcript, contentKey);
  const [helpOpen, setHelpOpen] = useState(false);

  // The page's keys (lib/chat-shortcuts.ts). Mod+F is the search hook's own;
  // a key a field or a menu already handled is left alone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      const action = decideShortcut(
        { key: e.key, mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, composing: e.isComposing },
        {
          typing: !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)),
          hasModal: !!document.querySelector('[aria-modal="true"]'),
          searchOpen: search.open,
          running: busy,
        },
      );
      if (!action || action === "find") return;
      e.preventDefault();
      if (action === "stop") stop();
      else if (action === "close-find") search.close();
      else if (action === "help") setHelpOpen(true);
      else if (action === "focus-composer") document.getElementById("lp-composer")?.focus();
      else if (action === "new-conversation") void fetcher.submit({}, { method: "post", action: "/chat?index" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, busy, stop, fetcher]);

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
            checkpoint={
              loaderData.session.summary && loaderData.session.summary_through_id
                ? { afterId: loaderData.session.summary_through_id, summary: loaderData.session.summary }
                : null
            }
            actions={{
              busy: busy || starting,
              onRegenerate: regenerate,
              askWith: loaderData.models,
              onRegenerateWith: regenerateWith,
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
              <span className="min-w-0 flex-1">
                {failure.code && FAILURE_CODES.has(failure.code) ? t(`chat.failureCode.${failure.code}`) : failure.message}
              </span>
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
            queuePaused={queue.paused && !busy ? queue.paused : null}
            onResume={queue.resume}
            models={loaderData.models}
            model={modelShown}
            onModel={pinModel}
            modelPending={modelPending}
            modelFailed={modelFailed}
            context={context}
            documents={loaderData.documents}
            uploadKB={firstKB}
            onHelp={() => setHelpOpen(true)}
            onUploaded={() => {
              if (!busy) revalidator.revalidate();
            }}
          />
          <ShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
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
  const [paused, setPaused] = useState<"stopped" | "failed" | null>(null);

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
      pause: (reason: "stopped" | "failed") => setPaused(reason),
      resume: () => setPaused(null),
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
