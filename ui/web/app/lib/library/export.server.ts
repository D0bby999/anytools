/**
 * library/export.server.ts
 * The whole catalogue as the API loads it into Postgres
 * (the private design notes): every item in catalogue order
 * with its position, whether its licence lets anyone reuse it, and its
 * folded search text; every source with what pins its data; and a version,
 * the sha256 of all of it. scripts/library/export.mjs writes it to
 * internal/library/catalogue.json.gz; a test fails when that file is stale.
 */
import { createHash } from "node:crypto";
import { fold } from "~/lib/vocab-types";
import fpb from "~/data/library/free-programming-books.json";
import textbooks from "~/data/library/textbooks.json";
import gutenberg from "~/data/library/gutenberg.json";
import openTextbooks from "~/data/library/open-textbooks.json";
import mitOcw from "~/data/library/mit-ocw.json";
import mitxOnline from "~/data/library/mitx-online.json";
import awesome from "~/data/library/awesome.json";
import { catalogue } from "~/lib/library/catalogue.server";
import { REUSABLE_LICENCES, type LibraryItem, type LibrarySource } from "~/lib/library/types";

export type ExportedItem = LibraryItem & { position: number; reusable: boolean; search: string };
export type CatalogueExport = { version: string; sources: LibrarySource[]; items: ExportedItem[] };

/** What pins each bundled catalogue, by the source name its items carry. */
function pinned(): Record<string, Omit<LibrarySource, "name" | "url">> {
  return {
    "free-programming-books": { licence: "CC BY 4.0 (the list)", pin: fpb.commit, read: "" },
    OpenStax: { licence: "per book", pin: "", read: textbooks.read },
    "Project Gutenberg": { licence: "public domain in the US", pin: gutenberg.dump, read: gutenberg.read },
    "Open Textbook Library": { licence: "per book", pin: "", read: openTextbooks.read },
    "MIT OpenCourseWare": { licence: "CC BY-NC-SA 4.0", pin: "", read: mitOcw.read },
    "MITx Online": { licence: "MIT's; free to take", pin: "", read: mitxOnline.read },
    ...Object.fromEntries(awesome.lists.map((l) => [l.repo, { licence: `${l.licence} (the list)`, pin: l.commit, read: "" }])),
  };
}

export function catalogueExport(): CatalogueExport {
  const { items } = catalogue();
  const pins = pinned();
  const sources = new Map<string, LibrarySource>();
  for (const i of items) {
    if (!sources.has(i.source.name)) sources.set(i.source.name, { name: i.source.name, url: i.source.url, ...(pins[i.source.name] ?? { licence: "", pin: "", read: "" }) });
  }
  const reusable = new Set<string>(REUSABLE_LICENCES);
  const exported = items.map((i, position) => ({
    // JSON drops what is undefined, so the version does not depend on it.
    ...(JSON.parse(JSON.stringify(i)) as LibraryItem),
    position,
    reusable: reusable.has(i.licence),
    search: fold([i.name, i.about, i.section, i.author].filter(Boolean).join(" ")),
  }));
  const body = { sources: [...sources.values()], items: exported };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { version, ...body };
}
