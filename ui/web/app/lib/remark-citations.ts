/**
 * remark-citations.ts
 *
 * Places citation chips inside rendered Markdown (components/rich-text.tsx).
 *
 * Two halves, because a marker has to survive the Markdown parser unchanged:
 *
 * 1. `protectCitations` swaps every `[[cite:<kind>:<id>]]` for a short
 *    placeholder, `⸨n⸩`, BEFORE parsing. The raw marker is not safe to parse:
 *    its brackets can pair with a stray link definition and an id like `_a_`
 *    can open emphasis. The placeholder's delimiters are Unicode punctuation,
 *    so emphasis next to one flanks exactly as it did next to the `[`.
 * 2. `remarkCitations` walks the parsed tree. In ordinary text a placeholder
 *    becomes a `lp-cite` element the component renders as a chip; in code,
 *    inline code and math it is put back as the literal marker, because text
 *    in those is shown as written.
 *
 * Chips are numbered in first-appearance order. A marker whose source is not
 * known produces nothing, as the chips always have: a visible marker with
 * nothing behind it would be the appearance of evidence.
 *
 * The streaming caret rides the same channel: `⸨c⸩` at the end of the text
 * becomes a `lp-caret` element where the text ends, so the caret sits after
 * the last word rather than on a line of its own below the last block.
 */
import { CITATION_PATTERN } from "~/lib/citations";

const OPEN = "\u2E28";
const CLOSE = "\u2E29";
const CARET = `${OPEN}c${CLOSE}`;
const PLACEHOLDER = /\u2E28(\d{1,5}|c)\u2E29/g;

/** A loose mdast/hast node: only the fields this walk reads or writes. */
type Node = {
  type: string;
  value?: string;
  children?: Node[];
  /** A GFM table's column alignments: one per column. */
  align?: unknown[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: Node[] };
};

export type Protected = { source: string; markers: string[] };

/** Replaces each marker with a placeholder; `markers[n]` is `<kind>:<id>`. */
export function protectCitations(text: string, streaming = false): Protected {
  const markers: string[] = [];
  CITATION_PATTERN.lastIndex = 0;
  const source = text.replace(CITATION_PATTERN, (_m, kind: string, id: string) => {
    markers.push(`${kind}:${id}`);
    return `${OPEN}${markers.length - 1}${CLOSE}`;
  });
  return { source: streaming ? source + CARET : source, markers };
}

export type CitationOptions = {
  markers: string[];
  /** The `<kind>:<id>` keys that have a source. */
  known: ReadonlySet<string>;
  /** The text was protected with `streaming`, so a caret is owed. */
  caret?: boolean;
};

/** The remark plugin. */
export function remarkCitations({ markers, known, caret = false }: CitationOptions) {
  return (tree: Node) => {
    const order: string[] = [];
    let caretPlaced = false;

    // A placeholder that is not ours (the text happened to contain `⸨7⸩`) is
    // left exactly as written.
    const literal = (s: string) =>
      s.replace(PLACEHOLDER, (m, t: string) => {
        if (t === "c") return caret ? "" : m;
        const key = markers[Number(t)];
        return key === undefined ? m : `[[cite:${key}]]`;
      });

    const restore = (nodes: Node[]) => {
      for (const n of nodes) {
        if (typeof n.value === "string") n.value = literal(n.value);
        if (n.children) restore(n.children);
      }
    };

    const split = (value: string): Node[] => {
      const out: Node[] = [];
      let cursor = 0;
      const re = new RegExp(PLACEHOLDER);
      for (let m = re.exec(value); m; m = re.exec(value)) {
        const node = element(m[1] ?? "");
        if (node === undefined) continue;
        if (m.index > cursor) out.push({ type: "text", value: value.slice(cursor, m.index) });
        if (node) out.push(node);
        cursor = m.index + m[0].length;
      }
      if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
      return out;
    };

    // undefined: not ours, keep the text. null: ours, render nothing.
    const element = (t: string): Node | null | undefined => {
      if (t === "c") {
        if (!caret) return undefined;
        if (caretPlaced) return null;
        caretPlaced = true;
        return { type: "lpCaret", data: { hName: "lp-caret" } };
      }
      const key = markers[Number(t)];
      if (key === undefined) return undefined;
      if (!known.has(key)) return null;
      if (!order.includes(key)) order.push(key);
      return {
        type: "lpCite",
        data: { hName: "lp-cite", hProperties: { dataCite: key, dataN: order.indexOf(key) + 1 } },
      };
    };

    const walk = (parent: Node, inLink: boolean, deferred: Node[]) => {
      // A row's cells past the header's column count are parsed but never
      // rendered (mdast-util-to-hast drops them). Drop them first, so a chip
      // or the caret in one is not counted as shown. Streaming hits this: the
      // caret after a row's last `|` parses as one more cell.
      if (parent.type === "table" && parent.align) {
        const columns = parent.align.length;
        for (const row of parent.children ?? []) row.children = row.children?.slice(0, columns);
      }
      const next: Node[] = [];
      for (const child of parent.children ?? []) {
        if (child.data?.hChildren) restore(child.data.hChildren);
        if (child.type === "text" && typeof child.value === "string") {
          for (const n of split(child.value)) {
            // A chip is a link; one inside a link's text would nest anchors,
            // so it is moved to just after that link.
            if (inLink && n.type === "lpCite") deferred.push(n);
            else next.push(n);
          }
          continue;
        }
        if (typeof child.value === "string") child.value = literal(child.value);
        next.push(child);
        if (!child.children) continue;
        const isLink = child.type === "link" || child.type === "linkReference";
        const after: Node[] = [];
        walk(child, inLink || isLink, isLink && !inLink ? after : deferred);
        next.push(...after);
      }
      parent.children = next;
    };

    walk(tree, false, []);
    // The text ended inside code or math, where the caret was removed as
    // literal: show it after the last block instead.
    if (caret && !caretPlaced) {
      tree.children = [...(tree.children ?? []), { type: "lpCaret", data: { hName: "lp-caret" } }];
    }
  };
}
