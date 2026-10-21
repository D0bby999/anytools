/**
 * app.api.search-index.ts
 * Resource route (loader only): the learner's own titles for the ⌘K search
 * (search-modal.tsx), fetched the first time the modal opens.
 *
 * Every source is the same list endpoint its page already uses, called with the
 * signed-in user's id, so the index can only ever hold what that learner can
 * open. Only a title, a link and the section it belongs to leave the server; a
 * source that fails is left out rather than failing the whole index.
 */
import type { Route } from "./+types/app.api.search-index";
import { requireUser } from "~/lib/auth.server";
import { listKBs } from "~/lib/kb.server";
import { listNotebooks } from "~/lib/notebook.server";
import { listBooks } from "~/lib/books.server";
import { listSessions } from "~/lib/chat.server";
import { listStates } from "~/lib/loop.server";
import type { SearchIndexItem } from "~/lib/nav-tree";

const LIMIT = 500;

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const id = user.id;
  const sources: Promise<SearchIndexItem[]>[] = [
    listKBs(id).then((r) => r.knowledge_bases.map((s) => ({ title: s.kb.name, to: `/knowledge/${s.kb.id}`, section: "nav.knowledge" }))),
    listNotebooks(id).then((r) => r.notebooks.map((n) => ({ title: n.name, to: `/notebooks/${n.id}`, section: "nav.notebooks" }))),
    listBooks(id).then((r) =>
      r.books.filter((b) => b.status !== "archived").map((b) => ({ title: b.title, to: `/books/${b.id}`, section: "nav.knowledge" })),
    ),
    listSessions(id).then((r) => r.sessions.map((s) => ({ title: s.title, to: `/chat/${s.id}`, section: "nav.chat" }))),
    listStates(id).then((r) => r.states.map((s) => ({ title: s.goal, to: `/loop/state/${s.id}`, section: "nav.loop" }))),
  ];
  const settled = await Promise.allSettled(sources);
  const items = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((i) => i.title.trim() !== "")
    .slice(0, LIMIT);
  return Response.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
