/**
 * card-links.ts
 * Turns a card entry form's link fields into the ids the API resolves.
 *
 * Nothing here decides whether an id is the learner's: the API resolves every
 * link against their own rows on save and on every read. This only refuses
 * shapes that could never be a link, so a typo gets a sentence rather than a
 * silent drop.
 */
import type { CardLink, CardLinkKind } from "~/lib/loop-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKABLE: CardLinkKind[] = ["note", "quiz_attempt"];

export type ParsedLinks = { links: Pick<CardLink, "kind" | "id" | "page">[] } | { error: string };

/**
 * Parses a pasted document address: `/documents/<id>` with an optional
 * `?page=N`, as a path or a full URL.
 */
export function parseDocumentAddress(raw: string): Pick<CardLink, "kind" | "id" | "page"> | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text, "http://anytools.invalid");
  } catch {
    return null;
  }
  const m = /^\/documents\/([^/]+)\/?$/.exec(url.pathname);
  if (!m || !m[1] || !UUID.test(m[1])) return null;
  const page = Number(url.searchParams.get("page") ?? "");
  return Number.isInteger(page) && page > 0 ? { kind: "document", id: m[1], page } : { kind: "document", id: m[1] };
}

export function parseCardLinks(form: FormData): ParsedLinks {
  const links: Pick<CardLink, "kind" | "id" | "page">[] = [];
  for (const value of form.getAll("link")) {
    const [kind, id] = String(value).split(":");
    if (!kind || !id || !LINKABLE.includes(kind as CardLinkKind) || !UUID.test(id)) {
      return { error: "One of the chosen links is not something that can be linked." };
    }
    links.push({ kind: kind as CardLinkKind, id });
  }
  const address = String(form.get("document_url") ?? "");
  if (address.trim()) {
    const doc = parseDocumentAddress(address);
    if (!doc) return { error: "That is not a document address. Copy it from the reader, like /documents/…?page=3." };
    links.push(doc);
  }
  return { links };
}
