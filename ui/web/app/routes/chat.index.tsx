/**
 * chat.index.tsx — the session list.
 *
 * It is a route rather than a panel inside the conversation view because a
 * session is a URL: a user who wants to send someone "the conversation where we
 * worked that out" needs a link, and a list that only exists as component state
 * has no link to give.
 */
import { PlateEmpty } from "~/components/ui/plate";
import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Pencil, Search, Trash2 } from "lucide-react";
import type { Route } from "./+types/chat.index";
import { appTitle } from "~/lib/app-title";
import { requireUser, requireUserId } from "~/lib/auth.server";
import { createSession, deleteSession, listSessions, patchSession, type ChatSession } from "~/lib/chat.server";
import { localDay } from "~/lib/local-day";
import { Button } from "~/components/ui/button";
import { requireUUID } from "~/lib/turns";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { listKBs } from "~/lib/kb.server";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Chat") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, user } = await requireUser(request);
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  const [{ sessions }, kbs] = await Promise.all([
    listSessions(userId, query),
    listKBs(userId).catch(() => ({ knowledge_bases: [] })),
  ]);
  return { groups: groupByDay(sessions, user.timezone), query, kbCount: kbs.knowledge_bases.length };
}

type Group = { key: "today" | "week" | "older"; sessions: ChatSession[] };

/**
 * Sessions under Today / Previous 7 days / Older, by the learner's own
 * calendar day. Done on the server, in their zone, so the page renders the
 * same groups it hydrates with.
 */
function groupByDay(sessions: ChatSession[], timezone: string): Group[] {
  const today = Date.parse(localDay(timezone));
  const by: Record<Group["key"], ChatSession[]> = { today: [], week: [], older: [] };
  for (const s of sessions) {
    const days = Math.round((today - Date.parse(localDay(timezone, new Date(s.updated_at)))) / 86_400_000);
    by[days <= 0 ? "today" : days <= 7 ? "week" : "older"].push(s);
  }
  return (["today", "week", "older"] as const)
    .map((key) => ({ key, sessions: by[key] }))
    .filter((g) => g.sessions.length > 0);
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = String(form.get("sessionId") ?? "");
    if (id) await deleteSession(userId, requireUUID(id));
    return redirect("/chat");
  }
  if (intent === "rename") {
    const id = requireUUID(String(form.get("sessionId") ?? ""));
    const title = String(form.get("title") ?? "").trim();
    if (title) await patchSession(userId, id, { title });
    return { ok: true };
  }

  // A conversation reads from the knowledge bases it is given, and nothing
  // else. A link from one knowledge base names it (kb_id); a plain "New
  // conversation" gets all of them, since a chat that can read none of the
  // learner's documents only ever answers "I cannot search anything".
  let kbIds = form.getAll("kb_id").map((v) => requireUUID(String(v)));
  if (kbIds.length === 0) {
    const { knowledge_bases } = await listKBs(userId).catch(() => ({ knowledge_bases: [] }));
    kbIds = knowledge_bases.map((k) => k.kb.id);
  }
  const session = await createSession(userId, { title: "", kb_ids: kbIds });
  return redirect(`/chat/${session.id}`);
}

export default function ChatIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { groups, query } = loaderData;
  const empty = groups.length === 0;

  return (
    <div className="lp-measure">
      <PageHeader
        title={t("chat.title")}
        lede={t("chat.lead")}
        actions={
          <Form method="post">
            <Button type="submit" disabled={busy}>
              <MessageSquarePlus aria-hidden="true" />
              {t("chat.new")}
            </Button>
          </Form>
        }
      />

      {loaderData.kbCount === 0 && (
        <p className="mb-6 rounded-lg border bg-part-soft px-4 py-3 text-sm leading-prose">
          {t("chat.noKnowledge")}{" "}
          <Link to="/knowledge" className="font-medium text-primary underline underline-offset-4">
            {t("chat.noKnowledgeLink")}
          </Link>
        </p>
      )}

      {(!empty || query) && (
        <Form method="get" role="search" className="mb-4 flex items-center gap-2">
          <label htmlFor="lp-chat-search" className="sr-only">
            {t("chat.searchLabel")}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              id="lp-chat-search"
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("chat.search")}
              className="h-10 w-full rounded-md border border-control-border bg-card pr-3 pl-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          {query ? (
            <Link to="/chat" className="text-sm text-primary underline underline-offset-4">
              {t("chat.searchClear")}
            </Link>
          ) : null}
        </Form>
      )}

      {empty ? (
        query ? (
          <p className="lp-empty">{t("chat.noMatches", { query })}</p>
        ) : (
          <PlateEmpty name="part-ask">{t("chat.noSessions")}</PlateEmpty>
        )
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`lp-chat-group-${group.key}`} className="mb-6">
            <h2 id={`lp-chat-group-${group.key}`} className="lp-section">
              {t(`chat.groups.${group.key}`)}
            </h2>
            <ul className="mt-2 divide-y border-y">
              {group.sessions.map((session) => (
                <SessionRow key={session.id} session={session} busy={busy} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function SessionRow({ session, busy }: { session: ChatSession; busy: boolean }) {
  const { t } = useTranslation("common");
  const [renaming, setRenaming] = useState(false);
  const title = session.title || t("chat.untitled");

  if (renaming) {
    return (
      <li className="py-3">
        <Form method="post" className="flex flex-wrap items-center gap-2" onSubmit={() => setRenaming(false)}>
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="sessionId" value={session.id} />
          <label htmlFor={`lp-rename-${session.id}`} className="sr-only">
            {t("chat.renameLabel")}
          </label>
          <input
            id={`lp-rename-${session.id}`}
            name="title"
            defaultValue={session.title}
            maxLength={200}
            required
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-10 min-w-0 flex-1 rounded-md border border-control-border bg-card px-3 font-serif text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="submit" size="sm">
            {t("chat.renameSave")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(false)}>
            {t("chat.renameCancel")}
          </Button>
        </Form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-2">
      <Link to={`/chat/${session.id}`} className="group min-h-11 min-w-0 flex-1 py-2">
        <span className="block truncate font-serif text-lg group-hover:text-primary group-hover:underline">
          {title}
        </span>
        <span className="block text-xs leading-ui text-muted-foreground">
          <DateText iso={session.updated_at} />
          {" · "}
          {session.kb_ids.length === 0
            ? t("chat.context.none")
            : t("chat.context.reads", { count: session.kb_ids.length })}
        </span>
      </Link>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label={t("chat.renameNamed", { title })}
        title={t("chat.rename")}
        className="text-muted-foreground"
        onClick={() => setRenaming(true)}
      >
        <Pencil aria-hidden="true" />
      </Button>
      <Form method="post">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="sessionId" value={session.id} />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={t("chat.deleteNamed", { title })}
          title={t("chat.delete")}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </Form>
    </li>
  );
}
