/**
 * mine.server.ts
 * The learner's own things across every knowledge base, for the "Mine" pages
 * (/files, /upload, /links). The API lists documents per knowledge base only,
 * so this asks for the bases, then for each base's documents at once, and
 * joins them. A learner has a handful of bases; this is one round trip deep.
 */
import { listDocuments, listKBs } from "~/lib/kb.server";
import { isLinkDocument, type MineDocument, type MineKB } from "~/lib/mine";

export async function listMine(userId: string): Promise<{ kbs: MineKB[]; documents: MineDocument[] }> {
  const { knowledge_bases } = await listKBs(userId);
  const bases = knowledge_bases.map((s) => s.kb);
  const lists = await Promise.all(bases.map((kb) => listDocuments(userId, kb.id)));
  const documents = lists
    .flatMap((list, i) => list.documents.map((doc) => ({ ...doc, kb_name: bases[i]!.name })))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  // Newest first, so the base a learner last worked in is the default target.
  const kbs = [...bases]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((kb) => ({ id: kb.id, name: kb.name }));
  return { kbs, documents };
}

/** The files (uploads) or the links, newest first. */
export async function listMineOf(userId: string, kind: "files" | "links") {
  const { kbs, documents } = await listMine(userId);
  return { kbs, documents: documents.filter((d) => isLinkDocument(d) === (kind === "links")) };
}
