import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronRight, ListFilter, Search, X } from "lucide-react";
import { useInertOutside, useModalFocus } from "~/components/layout/modal-layer";
import { OPEN_SEARCH_EVENT } from "~/components/layout/top-nav";
import { flatEntries, type SearchIndexItem } from "~/lib/nav-tree";
import { cn } from "~/lib/utils";

/** One row of the index: the path of titles it is shown under, and where it goes. */
type Doc = { titles: string[]; to: string; external?: boolean };

/**
 * Lower case with accents dropped, one character for one, so a match found in
 * the folded text marks the same characters in the original: "tieng" finds
 * "Tiếng Việt" and the mark lands on "Tiếng".
 */
export function fold(text: string): string {
  return [...text]
    .map((c) => (c === "đ" || c === "Đ" ? "d" : (c.normalize("NFD")[0] ?? c).toLowerCase()))
    .join("");
}

const words = (q: string) => fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Start offsets of every word in `text` (folded). */
function wordStarts(folded: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    if (/[\p{L}\p{N}]/u.test(folded[i]!) && (i === 0 || !/[\p{L}\p{N}]/u.test(folded[i - 1]!))) out.push(i);
  }
  return out;
}

/** Every query word must begin some word of the document's titles. */
function matchDoc(doc: Doc, query: string[]): boolean {
  const folded = fold(doc.titles.join(" "));
  const starts = wordStarts(folded);
  return query.every((w) => starts.some((s) => folded.startsWith(w, s)));
}

/**
 * The matches, the ones whose own title starts with the first word first,
 * otherwise in index order (which is the reading order for pages).
 */
export function search(docs: Doc[], query: string): Doc[] {
  const q = words(query);
  if (q.length === 0) return [];
  const hits = docs.filter((d) => matchDoc(d, q));
  const leads = (d: Doc) => fold(d.titles[d.titles.length - 1] ?? "").startsWith(q[0]!);
  return [...hits.filter(leads), ...hits.filter((d) => !leads(d))];
}

/** `text` with the starts of matching words wrapped in <mark>. */
function Highlight({ text, query }: { text: string; query: string[] }) {
  const folded = fold(text);
  const marks: [number, number][] = [];
  for (const s of wordStarts(folded)) {
    const w = query.filter((q) => folded.startsWith(q, s)).sort((a, b) => b.length - a.length)[0];
    if (w) marks.push([s, s + w.length]);
  }
  if (marks.length === 0) return <>{text}</>;
  const chars = [...text];
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], i) => {
    out.push(chars.slice(at, a).join(""));
    out.push(
      <mark key={i} className="rounded-[2px] bg-primary text-background">
        {chars.slice(a, b).join("")}
      </mark>,
    );
    at = b;
  });
  out.push(chars.slice(at).join(""));
  return <>{out}</>;
}

async function fetchIndex(): Promise<SearchIndexItem[]> {
  const res = await fetch("/app/api/search-index", { credentials: "same-origin" });
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: SearchIndexItem[] };
  return body.items ?? [];
}

const TOOL = "flex items-center justify-center rounded-xs p-2 text-muted-foreground transition-colors hover:text-primary disabled:opacity-[.37] disabled:hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:p-2";

/**
 * The ⌘K search, VitePress's VPLocalSearchBox: every page of NAV_TREE under
 * "Group › Page", plus the learner's own knowledge bases, notebooks, books,
 * chats and goals (app.api.search-index.ts, loaded the first time it opens).
 * Opens from the nav's search button, ⌘K / Ctrl K, or `/` outside a field.
 *
 * A modal dialog over the dimmed page: the input is a combobox driving a
 * listbox, ↑↓ move, Enter opens, Escape closes and focus returns to whatever
 * opened it. The query survives closing and reopening on the same page.
 */
export function SearchModal({ loadIndex = fetchIndex }: { loadIndex?: () => Promise<SearchIndexItem[]> }) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [detailed, setDetailed] = useState(false);
  const [own, setOwn] = useState<SearchIndexItem[] | null>(null);
  const loading = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);

  useInertOutside(open, layer);
  useModalFocus(open, layer, close, { initial: input });

  // A new page starts a new search.
  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  useEffect(() => {
    const show = () => setOpen(true);
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open || own || loading.current) return;
    loading.current = true;
    loadIndex()
      .then(setOwn)
      .catch(() => setOwn([]))
      .finally(() => {
        loading.current = false;
      });
  }, [open, own, loadIndex]);

  const docs = useMemo<Doc[]>(() => {
    const pages = flatEntries().map(({ group, page, parent }) => ({
      titles: [t(group.labelKey), ...(parent ? [t(parent.labelKey)] : []), t(page.labelKey)],
      to: page.to,
      external: page.external,
    }));
    const mine = (own ?? []).map((i) => ({ titles: [t(i.section), i.title], to: i.to }));
    return [...pages, ...mine];
  }, [t, own]);

  const results = useMemo(() => search(docs, query), [docs, query]);
  const q = useMemo(() => words(query), [query]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    const el = document.getElementById(`${listId}-${selected}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selected, listId]);

  function go(doc: Doc | undefined) {
    if (!doc) return;
    setOpen(false);
    if (doc.external) window.location.assign(doc.to);
    else navigate(doc.to);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[selected]);
    }
  }

  if (!open) return null;
  const empty = q.length > 0 && results.length === 0;

  return (
    <div ref={layer} className="fixed inset-0 z-[100] flex">
      <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-[var(--lp-backdrop)]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.label")}
        className={cn(
          "relative mx-auto my-16 flex max-h-[min(100vh-128px,900px)] w-[min(100vw-60px,900px)] flex-col gap-4 self-start rounded-[6px] bg-background p-3",
          "max-md:m-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:rounded-none",
        )}
      >
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="flex items-center gap-1 rounded-[4px] border px-3 focus-within:border-primary max-md:px-2 pointer-coarse:gap-2"
        >
          <button type="button" onClick={close} aria-label={t("search.back")} className={cn(TOOL, "md:hidden")}>
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <Search aria-hidden="true" className="m-2 size-4 shrink-0 text-muted-foreground max-md:hidden" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${listId}-${selected}` : undefined}
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-base outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-pressed={detailed}
            title={t("search.displayDetails")}
            aria-label={t("search.displayDetails")}
            onClick={() => setDetailed((d) => !d)}
            className={cn(TOOL, detailed && "text-primary")}
          >
            <ListFilter aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            disabled={!query}
            title={t("search.reset")}
            aria-label={t("search.reset")}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            className={TOOL}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </form>

        <ul id={listId} role="listbox" aria-label={t("search.results")} className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {results.map((doc, i) => (
            <li key={`${doc.to}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === selected}>
              <a
                href={doc.to}
                tabIndex={-1}
                onMouseMove={() => setSelected(i)}
                onClick={(e) => {
                  e.preventDefault();
                  go(doc);
                }}
                className={cn(
                  "block rounded-[4px] border-2 bg-background outline-none",
                  i === selected ? "border-primary" : "border-border",
                )}
              >
                <span className="m-3 flex flex-wrap items-center gap-1 text-base font-medium max-md:m-2">
                  <span aria-hidden="true" className="opacity-50">
                    #
                  </span>
                  {doc.titles.map((title, n) => (
                    <Fragment key={n}>
                      {n > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 opacity-50" /> : null}
                      <span className={n < doc.titles.length - 1 ? "text-muted-foreground" : undefined}>
                        <Highlight text={title} query={q} />
                      </span>
                    </Fragment>
                  ))}
                </span>
                {detailed ? (
                  <span className="mx-3 mb-3 block text-sm text-muted-foreground max-md:mx-2 max-md:mb-2">{doc.to}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>

        {empty ? (
          <p role="status" className="p-3 text-center text-sm text-muted-foreground">
            {t("search.noResults", { query })}
          </p>
        ) : null}

        <div className="flex gap-4 text-[0.8rem] opacity-75 max-md:hidden">
          <span>
            <kbd className="mr-1 inline-block min-w-6 rounded-[4px] border bg-hover px-1.5 py-[3px] text-center">↵</kbd>
            {t("search.select")}
          </span>
          <span>
            <kbd className="mr-1 inline-block min-w-6 rounded-[4px] border bg-hover px-1.5 py-[3px] text-center">↑</kbd>
            <kbd className="mr-1 inline-block min-w-6 rounded-[4px] border bg-hover px-1.5 py-[3px] text-center">↓</kbd>
            {t("search.navigate")}
          </span>
          <span>
            <kbd className="mr-1 inline-block min-w-6 rounded-[4px] border bg-hover px-1.5 py-[3px] text-center">esc</kbd>
            {t("search.close")}
          </span>
        </div>
      </div>
    </div>
  );
}
