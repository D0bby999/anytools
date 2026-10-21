/**
 * use-chat-search.ts — find in a conversation (after postclaw's chat search).
 *
 * Mod+F opens the bar (a second Mod+F inside it falls through to the
 * browser's own find). The hook reads the rendered text of every block marked
 * `data-chat-searchable` under the transcript, folded or not, matches it with
 * lib/chat-search.ts (case and diacritics folded), and highlights the exact
 * words with the CSS Custom Highlight API, so a match inside a rendered answer
 * is marked where it is. Going to a match opens the folds that hold it
 * (`data-fold-key`, components/chat/folds.tsx) and scrolls it to the middle.
 * Where the Highlight API is missing, the block holding the current match is
 * outlined instead. IME composition never opens it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { findHits, step } from "~/lib/chat-search";
import { useFolds } from "~/components/chat/folds";

export type ChatSearchController = {
  open: boolean;
  query: string;
  setQuery: (q: string) => void;
  /** 1-based position of the current match, 0 when there is none. */
  position: number;
  count: number;
  next: () => void;
  prev: () => void;
  show: () => void;
  close: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

const MATCH = "lp-chat-match";
const CURRENT = "lp-chat-match-current";

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };

function registry(): { highlights: HighlightRegistry; Highlight: new (...r: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return css?.highlights && Highlight ? { highlights: css.highlights, Highlight } : null;
}

/** Text nodes a reader sees, in the searchable blocks under `root`. */
function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  for (const block of root.querySelectorAll<HTMLElement>("[data-chat-searchable]")) {
    // A searchable block inside another is walked once, with its parent.
    if (block.parentElement?.closest("[data-chat-searchable]")) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest(".sr-only, [aria-hidden='true'], button, script, style, .katex-mathml")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  }
  return out;
}

export function useChatSearch(root: RefObject<HTMLElement | null>, contentKey: string): ChatSearchController {
  const folds = useFolds();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(-1);
  const [ranges, setRanges] = useState<Range[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const outlined = useRef<Element | null>(null);

  // Find: every time the query or the conversation's text changes.
  useEffect(() => {
    const el = root.current;
    if (!open || !el || query.trim() === "") {
      setRanges([]);
      setIndex(-1);
      return;
    }
    const nodes = textNodes(el);
    const hits = findHits(
      nodes.map((n) => n.data),
      query,
    );
    const found = hits.map((h) => {
      const r = document.createRange();
      r.setStart(nodes[h.segment]!, h.start);
      r.setEnd(nodes[h.segment]!, h.end);
      return r;
    });
    setRanges(found);
    setIndex((i) => (found.length === 0 ? -1 : Math.min(Math.max(i, 0), found.length - 1)));
  }, [open, query, contentKey, root]);

  // Paint: all matches, then the current one on top.
  useEffect(() => {
    const reg = registry();
    if (reg) {
      if (ranges.length === 0) {
        reg.highlights.delete(MATCH);
        reg.highlights.delete(CURRENT);
      } else {
        reg.highlights.set(MATCH, new reg.Highlight(...ranges));
        const cur = ranges[index];
        if (cur) reg.highlights.set(CURRENT, new reg.Highlight(cur));
        else reg.highlights.delete(CURRENT);
      }
    }
    return () => {
      reg?.highlights.delete(MATCH);
      reg?.highlights.delete(CURRENT);
    };
  }, [ranges, index]);

  // Go to the current match: open what folds it, then bring it into view.
  const current = ranges[index];
  useEffect(() => {
    outlined.current?.removeAttribute("data-search-current");
    outlined.current = null;
    if (!current) return;
    const el = current.startContainer.parentElement;
    if (!el) return;
    const keys: string[] = [];
    for (let f = el.closest<HTMLElement>("[data-fold-key]"); f; f = f.parentElement?.closest<HTMLElement>("[data-fold-key]") ?? null) {
      if (f.dataset.folded) keys.push(f.dataset.foldKey!);
    }
    if (keys.length > 0) folds.openAll(keys);
    if (!registry()) {
      const block = el.closest("[data-chat-searchable]");
      block?.setAttribute("data-search-current", "");
      outlined.current = block;
    }
    const id = requestAnimationFrame(() => el.scrollIntoView?.({ block: "center" }));
    return () => cancelAnimationFrame(id);
    // folds changes identity when a fold opens; going there once is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const show = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
      // Already in the bar: the browser's own find, for the rest of the page.
      if (document.activeElement === inputRef.current) return;
      e.preventDefault();
      show();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  return useMemo(
    () => ({
      open,
      query,
      setQuery,
      position: index + 1,
      count: ranges.length,
      next: () => setIndex((i) => step(i, ranges.length, 1)),
      prev: () => setIndex((i) => step(i, ranges.length, -1)),
      show,
      close,
      inputRef,
    }),
    [open, query, index, ranges.length, show, close],
  );
}
