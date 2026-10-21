import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * A block to read or copy (I8), VitePress's code block: the soft fill, 20px
 * above and below, 24px either side, the language in small print top right
 * and a 40×40 copy button that shows on hover or focus (always on a touch
 * screen). On a phone the block runs to the screen's edges.
 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="lp-code-block">
      <button
        type="button"
        className="lp-code-block-copy"
        data-copied={copied ? "true" : undefined}
        aria-label={copied ? t("doc.copied") : t("doc.copyCode")}
        onClick={copy}
      >
        {copied ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
      </button>
      {lang ? (
        <span className="lp-code-block-lang" aria-hidden="true">
          {lang}
        </span>
      ) : null}
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <span className="sr-only" role="status">
        {copied ? t("doc.copied") : ""}
      </span>
    </div>
  );
}
