/**
 * recent-conversations.tsx — Chat's child rows in the sidebar (plan
 * 261021-1100 phase 1, after postclaw's chat session rail).
 *
 * postclaw keeps its conversations in a rail beside the chat. AnyLearn's
 * sidebar is already the table of contents, and a third column (272 + 264 +
 * the 224 aside) would push the answer under its 780 measure, so the latest
 * conversations hang under Chat instead, as the TOC's own child rows: a dot
 * on one whose answer is still being written, the open one current, Rename
 * and Delete in each row's menu, then "All conversations".
 *
 * The rows come from the chat routes' loaders (`chatRecent`), read through
 * useMatches, so no other page pays a request for them.
 */
import { useState, useSyncExternalStore } from "react";
import { Link, useFetcher, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { Flyout, FLYOUT_ITEM } from "~/components/doc/flyout";
import { cn } from "~/lib/utils";

export type RecentConversation = { id: string; title: string; running?: boolean };

/** How many conversations hang under Chat. */
export const RECENT_LIMIT = 8;

/*
 * The open conversation whose answer is streaming, set by the conversation
 * page (which owns the stream) and read by the sidebar (which does not), so
 * the open row's dot follows the stream rather than the last load.
 */
let liveConversation: string | null = null;
const listeners = new Set<() => void>();

export function setLiveConversation(id: string | null) {
  if (liveConversation === id) return;
  liveConversation = id;
  for (const l of listeners) l();
}

function useLiveConversation(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => liveConversation,
    () => null,
  );
}

/** The recent list a matched chat route provides, or null elsewhere. */
export function useChatRecent(): { sessions: RecentConversation[]; current?: string } | null {
  const matches = useMatches();
  for (const m of [...matches].reverse()) {
    const data = m.data as { chatRecent?: RecentConversation[]; session?: { id: string } } | undefined;
    if (data?.chatRecent) return { sessions: data.chatRecent, current: data.session?.id };
  }
  return null;
}

const ROW =
  "-mx-2 flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function RecentConversations({ sessions, current }: { sessions: RecentConversation[]; current?: string }) {
  const { t } = useTranslation("common");
  const liveId = useLiveConversation();
  return (
    <ul className="flex flex-col" aria-label={t("chat.recent.label")}>
      {sessions.map((s) => (
        <li key={s.id}>
          <ConversationRow
            session={s}
            current={s.id === current}
            running={s.id === current ? s.id === liveId : !!s.running}
          />
        </li>
      ))}
      <li>
        <Link to="/chat" className={cn(ROW, "text-muted-foreground hover:bg-hover hover:text-foreground")}>
          {t("chat.recent.all")}
        </Link>
      </li>
    </ul>
  );
}

function ConversationRow({ session, current, running }: { session: RecentConversation; current: boolean; running: boolean }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher();
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const title = session.title || t("chat.untitled");
  // A rename or delete in flight shows as done.
  const pending = fetcher.formData;
  const shownTitle = pending?.get("intent") === "rename" ? String(pending.get("title")) : title;
  const deleting = pending?.get("intent") === "delete";

  if (deleting) return null;

  if (mode === "rename") {
    return (
      <fetcher.Form
        method="post"
        action="/chat?index"
        className="-mx-2 flex items-center gap-1 py-1"
        onSubmit={() => setMode("idle")}
      >
        <input type="hidden" name="intent" value="rename" />
        <input type="hidden" name="sessionId" value={session.id} />
        <input
          name="title"
          defaultValue={session.title}
          aria-label={t("chat.renameLabel")}
          maxLength={200}
          autoFocus
          required
          onKeyDown={(e) => {
            if (e.key === "Escape") setMode("idle");
          }}
          className="min-w-0 flex-1 rounded-md border border-control-border bg-card px-2 py-1 text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button type="submit" className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-hover">
          {t("chat.renameSave")}
        </button>
      </fetcher.Form>
    );
  }

  if (mode === "delete") {
    return (
      <fetcher.Form method="post" action="/chat?index" className="-mx-2 flex flex-wrap items-center gap-x-2 px-2 py-1 text-sm leading-6">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="sessionId" value={session.id} />
        {current ? null : <input type="hidden" name="stay" value="1" />}
        <span className="min-w-0 flex-1 truncate">{t("chat.recent.confirmDelete", { title })}</span>
        <button type="submit" className="font-medium text-destructive hover:underline" autoFocus>
          {t("chat.delete")}
        </button>
        <button type="button" className="font-medium text-muted-foreground hover:text-foreground" onClick={() => setMode("idle")}>
          {t("chat.renameCancel")}
        </button>
      </fetcher.Form>
    );
  }

  return (
    // The "…" button sits over the row's end and shows on hover or focus from
    // 960, so an idle title uses the row's whole width; on a touch screen it
    // is always there.
    <div className="group relative flex items-center">
      <Link
        to={`/chat/${session.id}`}
        aria-current={current ? "page" : undefined}
        className={cn(
          ROW,
          "pr-9 min-[960px]:pr-2 min-[960px]:group-focus-within:pr-9 min-[960px]:group-hover:pr-9",
          current
            ? "bg-selected font-semibold text-selected-foreground"
            : "text-muted-foreground hover:bg-hover hover:text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{shownTitle}</span>
        {running ? (
          <>
            <span aria-hidden="true" data-testid="running-dot" className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">{t("chat.recent.running")}</span>
          </>
        ) : null}
        {current ? <span className="sr-only"> {t("nav.current")}</span> : null}
      </Link>
      <Flyout
        label={t("chat.recent.actions", { title })}
        icon={<MoreHorizontal aria-hidden="true" className="size-4" />}
        hideChevron
        className="absolute top-0 -right-2"
        buttonClassName="size-8 h-8 justify-center rounded-md px-0 text-deco hover:bg-hover hover:text-foreground min-[960px]:opacity-0 min-[960px]:group-hover:opacity-100 min-[960px]:group-focus-within:opacity-100 aria-expanded:opacity-100"
        menuClassName="top-9"
      >
        <button type="button" className={FLYOUT_ITEM} onClick={() => setMode("rename")}>
          {t("chat.rename")}
        </button>
        <button type="button" className={FLYOUT_ITEM + " text-destructive hover:text-destructive"} onClick={() => setMode("delete")}>
          {t("chat.delete")}
        </button>
      </Flyout>
    </div>
  );
}
