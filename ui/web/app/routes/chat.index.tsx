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
import { MoreHorizontal } from "lucide-react";
import type { Route } from "./+types/chat.index";
import { appTitle } from "~/lib/app-title";
import { requireUser, requireUserId } from "~/lib/auth.server";
import { createSession, deleteSession, listSessions, patchSession, type ChatSession } from "~/lib/chat.server";
import { localDay } from "~/lib/local-day";
import { Button } from "~/components/ui/button";
import { requireUUID } from "~/lib/turns";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { Field } from "~/components/doc/field";
import { Flyout, FLYOUT_ITEM } from "~/components/doc/flyout";
import { RECENT_LIMIT } from "~/components/chat/recent-conversations";
import { NewConversation } from "~/components/chat/new-conversation";
import { listKBs } from "~/lib/kb.server";
import { NOTE_JOIN } from "~/lib/sentence";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Chat") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, user } = await requireUser(request);
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  const [{ sessions }, kbs, recent] = await Promise.all([
    listSessions(userId, query),
    listKBs(userId).catch(() => ({ knowledge_bases: [] })),
    // The sidebar's rows under Chat are the latest, whatever the search.
    query ? listSessions(userId, "", RECENT_LIMIT).catch(() => ({ sessions: [] })) : null,
  ]);
  return {
    groups: groupByDay(sessions, user.timezone),
    chatRecent: (recent?.sessions ?? sessions.slice(0, RECENT_LIMIT)).map((s) => ({
      id: s.id,
      title: s.title,
      running: s.running,
    })),
    query,
    kbCount: kbs.knowledge_bases.length,
    // For the quick-start's "Reads" menu; the action already takes kb_id.
    kbs: kbs.knowledge_bases.map((k) => ({ id: k.kb.id, name: k.kb.name })),
  };
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
    // From the sidebar, deleting another conversation keeps the reader where
    // they are; deleting the open one comes back to the list.
    if (form.get("stay") === "1") return { ok: true };
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

/**
 * The list of conversations, as up's "recent updates" (P4): h1, lede, the
 * page's one action as a quick-start, then "Recent", each conversation one
 * line of **date** · title — what it reads, under the learner's own day
 * groups. Renaming and deleting sit in the line's "…" menu.
 */
export default function ChatIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { groups, query, kbs } = loaderData;
  const empty = groups.length === 0;

  return (
    <div className="lp-doc">
      <PageHeader title={t("chat.title")} lede={t("chat.lead")} className="mb-0" />

      <NewConversation kbs={kbs} busy={busy} />

      {loaderData.kbCount === 0 && (
        <p>
          {t("chat.noKnowledge")} <Link to="/knowledge">{t("chat.noKnowledgeLink")}</Link>
        </p>
      )}

      <section aria-labelledby="lp-chat-recent">
        <h2 id="lp-chat-recent">{t("chat.index.recent")}</h2>

        {(!empty || query) && (
          <Form method="get" role="search" className="my-4 flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <Field label={t("chat.searchLabel")}>
                <input id="lp-chat-search" type="search" name="q" defaultValue={query} placeholder={t("chat.search")} />
              </Field>
            </div>
            {query ? (
              <Link to="/chat" className="mb-3 text-sm">
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
            <section key={group.key} aria-labelledby={`lp-chat-group-${group.key}`}>
              <h3 id={`lp-chat-group-${group.key}`}>{t(`chat.groups.${group.key}`)}</h3>
              <ul className="lp-dated-list">
                {group.sessions.map((session) => (
                  <SessionRow key={session.id} session={session} busy={busy} />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </div>
  );
}

function SessionRow({ session, busy }: { session: ChatSession; busy: boolean }) {
  const { t } = useTranslation("common");
  const [renaming, setRenaming] = useState(false);
  const title = session.title || t("chat.untitled");

  if (renaming) {
    return (
      <li>
        <Form method="post" className="flex flex-wrap items-end gap-3 py-1" onSubmit={() => setRenaming(false)}>
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="sessionId" value={session.id} />
          <div className="min-w-0 flex-1">
            <Field label={t("chat.renameLabel")}>
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
              />
            </Field>
          </div>
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
    <li>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <strong>
            <DateText iso={session.updated_at} />
          </strong>
          {" · "}
          <Link to={`/chat/${session.id}`}>{title}</Link>
          {session.running ? (
            <>
              {NOTE_JOIN}
              <span className="font-medium text-primary">{t("chat.recent.running")}</span>
            </>
          ) : null}
          {NOTE_JOIN}
          <span className="text-muted-foreground">
            {session.kb_ids.length === 0
              ? t("chat.context.none")
              : t("chat.context.reads", { count: session.kb_ids.length })}
          </span>
        </span>
        <Flyout
          label={t("chat.index.actionsFor", { title })}
          icon={<MoreHorizontal aria-hidden="true" className="size-4" />}
          hideChevron
          buttonClassName="h-8 rounded-sm px-2 text-muted-foreground"
          menuClassName="top-9"
        >
          <button
            type="button"
            disabled={busy}
            aria-label={t("chat.renameNamed", { title })}
            className={FLYOUT_ITEM}
            onClick={() => setRenaming(true)}
          >
            {t("chat.rename")}
          </button>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              disabled={busy}
              aria-label={t("chat.deleteNamed", { title })}
              className={FLYOUT_ITEM + " text-destructive hover:text-destructive"}
            >
              {t("chat.delete")}
            </button>
          </Form>
        </Flyout>
      </div>
    </li>
  );
}
