import { useContext, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { readDiagramTheme } from "~/lib/diagram-theme";
import { DiagramErrorContext } from "~/components/diagram/diagram-error";

/**
 * A `mermaid` fence, drawn. The source is untrusted: a model wrote it, maybe
 * after reading an attacker's page, and Mermaid has a steady advisory stream
 * (learning-depth research, external §4; red team SF-1).
 *
 * - Mermaid is pinned to an exact version and loaded only when a diagram is
 *   on the page.
 * - `securityLevel: 'strict'` and no HTML labels, so no `foreignObject` HTML
 *   is produced.
 * - The SVG is never put into the page. It is shown as `<img src="blob:…">`:
 *   an SVG image runs no script, loads nothing and cannot be clicked, so a
 *   payload that got past Mermaid's own sanitiser is inert. (Mermaid does lay
 *   the diagram out in a temporary node of its own, which it removes.)
 * - The source is capped, and a render that has not finished in 3 s is given
 *   up. On any failure the source is shown as code with a one-line note.
 */
export const MERMAID_LIMITS = { chars: 6000, lines: 300, timeoutMs: 3000 } as const;

/** What mermaid.initialize is given. Exported for the regression test. */
export function mermaidConfig() {
  const theme = readDiagramTheme();
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: MERMAID_LIMITS.chars,
    theme: "base" as const,
    themeVariables: {
      background: theme.paper,
      primaryColor: theme.brandSoft,
      primaryTextColor: theme.ink,
      primaryBorderColor: theme.brand,
      lineColor: theme.muted,
      secondaryColor: theme.surface,
      tertiaryColor: theme.surface,
      textColor: theme.ink,
      fontFamily: theme.fontSans,
    },
  };
}

/**
 * Directives (`%%{init}%%`) and click handlers are refused outright, as the
 * server refuses them in "Draw it": a fence a model wrote unasked gets the
 * same rule. Mermaid would ignore a directive's securityLevel, but not having
 * to rely on that is the point.
 */
const FORBIDDEN = /%%\{|^\s*click\s/im;

/** Why a source is not drawn at all, or null when it may be. */
export function mermaidRefusal(source: string): "too_large" | "not_allowed" | null {
  if (source.length > MERMAID_LIMITS.chars || source.split("\n").length > MERMAID_LIMITS.lines) return "too_large";
  return FORBIDDEN.test(source) ? "not_allowed" : null;
}

type State = { kind: "drawing" } | { kind: "drawn"; url: string } | { kind: "failed" };

export function MermaidBlock({ source, caption }: { source: string; caption?: string }) {
  const { t } = useTranslation("common");
  const id = `lp-mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const refusal = mermaidRefusal(source);
  const fits = refusal === null;
  const [state, setState] = useState<State>(fits ? { kind: "drawing" } : { kind: "failed" });
  const reportError = useContext(DiagramErrorContext);

  useEffect(() => {
    if (!fits) return;
    let cancelled = false;
    let url = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), MERMAID_LIMITS.timeoutMs);
    });
    const draw = (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize(mermaidConfig());
      await mermaid.parse(source);
      const { svg } = await mermaid.render(id, source);
      return svg;
    })();
    Promise.race([draw, timeout])
      .then((svg) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setState({ kind: "drawn", url });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "failed" });
        // Mermaid's own parse message is what a repair needs; a timeout has
        // none worth sending.
        if (error instanceof Error && error.message !== "timeout") reportError?.(error.message);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, id, fits, reportError]);

  const label = caption || t("diagram.mermaidAlt");
  if (state.kind === "failed") {
    return (
      <figure className="lp-diagram">
        <pre>
          <code>{source}</code>
        </pre>
        <figcaption className="text-xs text-muted-foreground">
          {refusal === "too_large" ? t("diagram.tooLarge") : t("diagram.couldNotDraw")}
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="lp-diagram">
      {state.kind === "drawn" ? (
        <img src={state.url} alt={label} className="mx-auto max-h-[36rem] max-w-full" />
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {t("diagram.drawing")}
        </p>
      )}
      {caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{t("diagram.source")}</summary>
        <pre>
          <code>{source}</code>
        </pre>
      </details>
    </figure>
  );
}
