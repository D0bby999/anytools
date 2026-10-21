import { useTranslation } from "react-i18next";
import { parseAnsi, stripAnsi } from "~/lib/ansi";
import { CodeFrame } from "./code-block";

/**
 * Terminal output with its colours (after postclaw's `render/ansi-block.tsx`),
 * in the theme's inks rather than the terminal's. Runs become React elements,
 * never HTML: the output may have been steered by a document the model read.
 * Copy takes the text without its escape codes.
 */
export function AnsiBlock({ text }: { text: string }) {
  const { t } = useTranslation("common");
  const lines = parseAnsi(text);
  return (
    <CodeFrame kind="terminal" copy={stripAnsi(text)} label={t("richText.terminal")}>
      <code>
        {lines.map((line, i) => (
          <span key={i}>
            {line.map((span, j) =>
              span.style ? (
                <span
                  key={j}
                  style={{
                    // Dim is a quieter ink, not a fade, so it keeps AA.
                    color: span.style.color ?? (span.style.dim ? "var(--lp-ink-3)" : undefined),
                    fontWeight: span.style.bold ? 600 : undefined,
                    fontStyle: span.style.italic ? "italic" : undefined,
                    textDecoration: span.style.underline ? "underline" : undefined,
                  }}
                >
                  {span.text}
                </span>
              ) : (
                span.text
              ),
            )}
            {i < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </CodeFrame>
  );
}
