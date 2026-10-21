/**
 * feedback-dialog.tsx — why an answer was not good (after postclaw's
 * FeedbackDialog, itself DeepSeek Harness's).
 *
 * Only a Dislike opens it: a Like records at once, because asking for a
 * reason on every Like is the friction that stops people rating. One optional
 * reason (click again to clear) and an optional comment; sending with neither
 * still records the rating. The reasons mirror pg.FeedbackCategories.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useInertOutside, useModalFocus } from "~/components/layout/modal-layer";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export const BAD_FEEDBACK_CATEGORIES = ["wrong_info", "ignored_material", "unclear", "too_long", "tool_failed", "other"] as const;

const COMMENT_MAX = 2000;

export function FeedbackDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** Records the rating; resolves false when the server refused it. */
  onSubmit: (details: { category?: string; comment?: string }) => Promise<boolean>;
}) {
  const { t } = useTranslation("common");
  const [category, setCategory] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const commentId = useId();

  useEffect(() => {
    if (!open) return;
    setCategory(null);
    setComment("");
    setBusy(false);
    setError(false);
  }, [open]);

  const close = () => {
    if (!busy) onClose();
  };
  useInertOutside(open, layer);
  useModalFocus(open, layer, close);

  if (!open || typeof document === "undefined") return null;

  const submit = async () => {
    setBusy(true);
    setError(false);
    const ok = await onSubmit({ category: category ?? undefined, comment: comment.trim() || undefined });
    setBusy(false);
    if (ok) onClose();
    else setError(true);
  };

  return createPortal(
    <div ref={layer} className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:items-center">
      <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-[var(--lp-backdrop)]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="chat-feedback-dialog"
        className="relative mt-16 w-full max-w-md rounded-xl bg-background p-6 shadow-md sm:mt-0"
      >
        <h2 id={titleId} className="font-serif text-xl leading-7 font-semibold">
          {t("chat.feedback.title")}
        </h2>
        <div role="group" aria-label={t("chat.feedback.reasons")} className="mt-4 flex flex-wrap gap-2">
          {BAD_FEEDBACK_CATEGORIES.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory((c) => (c === key ? null : key))}
              className={cn(
                "min-h-8 rounded-full border px-3 py-1 text-sm leading-6 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                category === key
                  ? "border-primary bg-selected font-medium text-selected-foreground"
                  : "border-control-border bg-card text-foreground hover:bg-hover",
              )}
            >
              {t(`chat.feedback.reason.${key}`)}
            </button>
          ))}
        </div>
        <label htmlFor={commentId} className="mt-4 block text-sm leading-6 font-medium">
          {t("chat.feedback.comment")}
        </label>
        <textarea
          id={commentId}
          value={comment}
          maxLength={COMMENT_MAX}
          rows={3}
          disabled={busy}
          placeholder={t("chat.feedback.commentPlaceholder")}
          onChange={(e) => setComment(e.target.value)}
          className="mt-1 w-full resize-y rounded-md border border-control-border bg-card px-3 py-2 text-base leading-prose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm leading-6 text-destructive">
            {t("chat.feedback.failed")}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            {t("chat.feedback.cancel")}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {t("chat.feedback.send")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
