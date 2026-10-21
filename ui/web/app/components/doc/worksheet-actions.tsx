import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StatusLine } from "~/components/doc/status-line";

/**
 * "Download Markdown" and "Copy worksheet" over a worksheet, up's
 * WorksheetActions.vue: a soft box with one sentence and two buttons, and a
 * status line that says what happened. Phase 12 places it on /toolkit/:id.
 *
 * The copy fetches the Markdown export and writes it to the clipboard within
 * the same click. Where ClipboardItem exists the write is handed a promise of
 * the text, so Safari, which drops a clipboard write that happens after an
 * await, still counts it as part of the gesture (up does the same).
 */
export function WorksheetActions({
  href,
  filename,
  extra,
}: {
  /** The Markdown export, e.g. `/toolkit/:id/export.md`. */
  href: string;
  filename?: string;
  /** Another action in the same row, e.g. "Save to my Drive". */
  extra?: ReactNode;
}) {
  const { t } = useTranslation("common");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);

  // A worksheet that changes, or a page that goes, cancels a copy in flight.
  useEffect(() => {
    setFeedback(null);
    return () => controller.current?.abort();
  }, [href]);

  const copy = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const request = new AbortController();
    controller.current = request;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      const text = fetch(href, { signal: request.signal }).then((response) => {
        if (!response.ok) throw new Error("Worksheet unavailable");
        return response.text();
      });
      if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
        blob.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      if (!request.signal.aborted) setFeedback({ text: t("doc.worksheet.copied"), error: false });
    } catch {
      if (!request.signal.aborted) setFeedback({ text: t("doc.worksheet.copyFailed"), error: true });
    } finally {
      if (controller.current === request) {
        controller.current = undefined;
        setBusy(false);
      }
    }
  };

  return (
    <section className="lp-worksheet-actions" aria-label={t("doc.worksheet.label")}>
      <p>{t("doc.worksheet.lead")}</p>
      <div className="lp-worksheet-actions-buttons">
        <a className="lp-worksheet-actions-button" href={href} download={filename ?? true}>
          {t("doc.worksheet.download")}
        </a>
        <button type="button" className="lp-worksheet-actions-button" disabled={busy} aria-busy={busy || undefined} onClick={copy}>
          {busy ? t("doc.worksheet.copying") : t("doc.worksheet.copy")}
        </button>
        {extra}
      </div>
      <StatusLine tone={feedback?.error ? "error" : "info"}>{feedback?.text}</StatusLine>
    </section>
  );
}
