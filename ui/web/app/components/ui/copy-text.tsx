import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Button } from "~/components/ui/button";

/**
 * "Copy" beside Listen under an answer, and on a code block. An answer is
 * copied as the Markdown it was written in, minus citation markers (they mean
 * nothing outside this page); a code block exactly.
 */
export function CopyText({ text, markdown = false, className }: { text: string; markdown?: boolean; className?: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown ? withoutCitations(text) : text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (an insecure origin, a denied permission): nothing to say.
    }
  }
  return (
    <Button type="button" size="sm" variant="ghost" className={className ?? "mt-1 h-8 px-2 text-xs"} onClick={copy}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? t("chat.copied") : t("chat.copy")}</span>
    </Button>
  );
}

/** Drops [[cite:…]] markers, keeping the sentence around them intact. */
export function withoutCitations(text: string): string {
  return text.replace(/\s?\[\[cite:[^\]]*\]\]/g, "");
}
