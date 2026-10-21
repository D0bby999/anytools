import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CopyText } from "~/components/ui/copy-text";
import type { HighlightSpan } from "~/lib/highlight";

/** Fence names that mean "no language": nothing to highlight, nothing to fetch. */
const PLAIN = new Set(["", "text", "txt", "plain", "plaintext"]);

/**
 * A fenced block's frame, shared by code, diff and terminal output: a caption
 * naming what it holds, a Copy that takes the block exactly, and the body,
 * which scrolls sideways and takes focus so a keyboard can scroll it (axe).
 */
export function CodeFrame({
  label,
  copy,
  kind,
  children,
}: {
  label: ReactNode;
  copy: string;
  kind: "code" | "diff" | "terminal";
  children: ReactNode;
}) {
  return (
    <figure className="lp-code" data-block={kind}>
      <figcaption className="flex min-h-9 items-center justify-between gap-2 border-b border-border py-1 ps-3 pe-1 font-sans text-xs text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{label}</span>
        <CopyText text={copy} className="h-7 shrink-0 px-2 text-xs" />
      </figcaption>
      <pre tabIndex={0}>{children}</pre>
    </figure>
  );
}

/**
 * A code block, highlighted (after postclaw's `render/code-block.tsx`). It
 * renders plain at once, on the server too, and colours in place once the
 * highlighter has loaded; shiki is imported here and nowhere else, so an
 * answer without code never downloads it.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { t } = useTranslation("common");
  const lines = useHighlight(code, lang);
  return (
    <CodeFrame label={PLAIN.has(lang.toLowerCase()) ? t("richText.code") : lang} copy={code} kind="code">
      <code data-highlighted={lines ? "" : undefined}>
        {lines
          ? lines.map((line, i) => (
              <Line key={i} spans={line} last={i === lines.length - 1} />
            ))
          : code}
      </code>
    </CodeFrame>
  );
}

function Line({ spans, last }: { spans: HighlightSpan[]; last: boolean }) {
  return (
    <>
      {spans.map((span, i) => (
        <span
          key={i}
          style={{
            color: span.color,
            fontStyle: span.italic ? "italic" : undefined,
            fontWeight: span.bold ? 600 : undefined,
          }}
        >
          {span.text}
        </span>
      ))}
      {last ? null : "\n"}
    </>
  );
}

function useHighlight(code: string, lang: string): HighlightSpan[][] | undefined {
  const [result, setResult] = useState<{ key: string; lines: HighlightSpan[][] | undefined }>();
  const key = `${lang}\u0000${code}`;
  useEffect(() => {
    if (PLAIN.has(lang.toLowerCase())) return;
    let alive = true;
    import("~/lib/highlight")
      .then(({ highlightLines }) => highlightLines(code, lang))
      .then((lines) => alive && setResult({ key, lines }))
      // Offline, or a chunk gone after a deploy: the plain text stays.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code, lang, key]);
  return result?.key === key ? result.lines : undefined;
}
