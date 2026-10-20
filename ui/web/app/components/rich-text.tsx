import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Source } from "~/hooks/use-turn-stream";
import { CitationChip } from "~/components/chat/citation-chip";
import { NoRemoteImage } from "~/components/no-remote-image";
import { ChartBlock } from "~/components/diagram/chart-block";
import { MermaidBlock } from "~/components/diagram/mermaid-block";
import { DiagramErrorContext } from "~/components/diagram/diagram-error";
import { protectCitations, remarkCitations } from "~/lib/remark-citations";
import { CopyText } from "~/components/ui/copy-text";
import { ListenButton } from "~/components/vocab/listen-button";

/**
 * A model's answer, rendered: Markdown with GFM (tables, strikethrough, task
 * lists) and LaTeX math, with citation markers as chips where the claim was
 * made. Chat, Solve, Research and quiz explanations all show answers through
 * this one component, so the safety rules below are stated once.
 *
 * The text is untrusted — a model that read an attacker's document wrote it.
 *
 * - Raw HTML is never rendered. `rehype-raw` is not enabled, so `<script>` or
 *   `<img onerror>` in the text arrives as visible text, not as an element.
 * - react-markdown's default URL transform stays on and drops `javascript:`
 *   and other unsafe schemes. A link left with no href renders as its text.
 * - Images are links, never loaded (NoRemoteImage, security audit F-13).
 * - KaTeX runs with `trust: false`, so `\href`, `\url` and `\htmlData` do
 *   nothing, and with size and macro-expansion limits so a hostile formula
 *   cannot eat the page. Bad LaTeX renders as its source in the danger ink.
 *
 * While `streaming`, the text is half-written Markdown on every render; the
 * parser takes any prefix without throwing, and an unclosed `$$` is simply
 * an unfinished math block until the closing `$$` arrives.
 *
 * Diagrams: a fence tagged `mermaid` or `chart` is drawn (components/diagram,
 * with their own safety rules), but only once the answer has finished, never
 * from a half-written fence. Every other fence stays a code block.
 */
export function RichText({
  text,
  sources,
  streaming = false,
  onDiagramError,
  listen = true,
  actions,
}: {
  text: string;
  sources: Source[];
  streaming?: boolean;
  /** Offer read-aloud (default). Off for a line too short to be worth it. */
  listen?: boolean;
  /** More controls for the answer (chat's "Draw it"), on Listen's line. */
  actions?: ReactNode;
  /** Called with Mermaid's parse error when a diagram in the text cannot be drawn. */
  onDiagramError?: (error: string) => void;
}) {
  const bySource = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s]));
  const { source, markers } = protectCitations(text, streaming);

  return (
    <SourcesContext.Provider value={bySource}>
      <StreamingContext.Provider value={streaming}>
        <DiagramErrorContext.Provider value={onDiagramError ?? null}>
          <div className="lp-prose lp-rich">
            <Markdown
              remarkPlugins={[
                remarkGfm,
                remarkMath,
                [remarkCitations, { markers, known: new Set(bySource.keys()), caret: streaming }],
              ]}
              rehypePlugins={[[rehypeKatex, KATEX]]}
              components={COMPONENTS}
            >
              {source}
            </Markdown>
          </div>
          {/* Learning depth, phase 7: read the answer aloud; renders nothing
              without speechSynthesis. */}
          {streaming ? null : listen || actions ? (
            <div className="mt-1 flex flex-wrap items-start gap-1">
              {listen ? <ListenButton text={text} /> : null}
              {actions}
            </div>
          ) : null}
        </DiagramErrorContext.Provider>
      </StreamingContext.Provider>
    </SourcesContext.Provider>
  );
}

const SourcesContext = createContext<ReadonlyMap<string, Source>>(new Map());
const StreamingContext = createContext(false);

type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] };

/** A fenced block's language and text, when `pre` holds exactly one `code`. */
function fenceOf(node: HastNode | undefined): { lang: string; text: string } | null {
  const code = node?.children?.find((c) => c.type === "element");
  if (!code || code.tagName !== "code") return null;
  const classes = Array.isArray(code.properties?.className) ? (code.properties.className as unknown[]) : [];
  const lang = classes.map(String).find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "";
  const text = (code.children ?? []).map((c) => c.value ?? "").join("").replace(/\n$/, "");
  return { lang, text };
}

/** A code block, or a diagram when the fence asks for one and the answer is complete. */
function Fence({ node, children, ...rest }: ComponentProps<"pre"> & { node?: HastNode }) {
  const streaming = useContext(StreamingContext);
  const fence = streaming ? null : fenceOf(node);
  if (fence?.lang === "mermaid") return <MermaidBlock source={fence.text} />;
  if (fence?.lang === "chart") return <ChartBlock source={fence.text} />;
  // A code block can scroll sideways: it takes focus, so a keyboard can scroll it (axe).
  if (!fence || fence.text === "") return <pre tabIndex={0} {...rest}>{children}</pre>;
  // A finished code block can be copied exactly, without selecting it.
  return (
    <div className="relative">
      <pre tabIndex={0} {...rest}>
        {children}
      </pre>
      <CopyText text={fence.text} className="absolute top-1.5 right-1.5 h-7 bg-card px-2 text-xs" />
    </div>
  );
}

/** A `lp-cite` element from remark-citations: its chip, if the source is known. */
function Cite({ "data-cite": key, "data-n": n }: { "data-cite"?: string; "data-n"?: number | string }) {
  const hit = useContext(SourcesContext).get(key ?? "");
  if (!hit) return null;
  return (
    <span className="lp-chip mx-0.5">
      <CitationChip source={hit} index={Number(n)} />
    </span>
  );
}

// `lp-cite` and `lp-caret` are remark-citations' own tags. react-markdown looks
// components up by tag name at runtime; its type only lists HTML's tags.
const COMPONENTS = {
  a: SafeLink,
  img: NoRemoteImage,
  table: ScrollingTable,
  pre: Fence,
  "lp-cite": Cite,
  "lp-caret": Caret,
} as Components;

/** KaTeX settings. `trust` is left at its default, false, on purpose. */
const KATEX = {
  throwOnError: false,
  // Painted with the world's danger token rather than KaTeX's own red.
  errorColor: "var(--lp-danger)",
  strict: "ignore",
  // `\rule{1000em}{1000em}` and friends are capped at 10em.
  maxSize: 10,
  // Recursive macros stop after this many expansions instead of hanging.
  maxExpand: 500,
} as const;

/**
 * A link. An external one opens in a new tab with no opener and no referrer;
 * one whose URL the sanitiser removed renders as its text, not as `href=""`
 * pointing back at the page.
 */
function SafeLink({ href, children, node: _node, ...rest }: ComponentProps<"a"> & { node?: unknown }) {
  if (!href) return <span>{children}</span>;
  if (/^https?:\/\//i.test(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

/**
 * A table scrolls sideways inside its own box instead of widening a phone's
 * page. The box takes focus, so a keyboard can scroll it too (a scroll region
 * nobody can focus is out of reach without a pointer).
 */
function ScrollingTable({ children, node: _node, ...rest }: ComponentProps<"table"> & { node?: unknown }) {
  const { t } = useTranslation("common");
  return (
    <div
      className="lp-table-scroll rounded-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      data-lp-scroll=""
      role="region"
      aria-label={t("richText.table")}
      tabIndex={0}
    >
      <table {...rest}>{children}</table>
    </div>
  );
}

/** The streaming caret, where the text currently ends. */
function Caret(): ReactNode {
  return (
    <span
      aria-hidden="true"
      data-caret=""
      className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary"
    />
  );
}
