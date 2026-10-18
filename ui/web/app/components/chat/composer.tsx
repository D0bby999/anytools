import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square } from "lucide-react";
import { Button } from "~/components/ui/button";
import { OwnVersionFields } from "~/components/chat/own-version-fields";
import { emptyOwnVersion, ownVersionComplete, type OwnVersion } from "~/lib/own-version";

/**
 * The composer.
 *
 * `+` opens the reference picker — a one-shot attachment of a document to THIS
 * message, as distinct from the sticky session context in the context bar.
 * Phase 5 supplies the documents; until then the button says so rather than
 * opening an empty menu, because a control that opens onto nothing teaches a
 * user that the feature is broken.
 *
 * Enter sends; Shift+Enter is a newline. A question with a pasted excerpt in it
 * is a normal case here, so the textarea grows to a few lines rather than
 * staying one tall.
 *
 * With "write my own version first" on (up-methods phase 11), three lines sit
 * above the message and Send waits until all three are written; the server
 * refuses the turn without them anyway.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  disabledReason,
  ownVersionFirst = false,
}: {
  onSend: (message: string, ownVersion?: OwnVersion) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** The learner's "write my own version first" switch. */
  ownVersionFirst?: boolean;
}) {
  const { t } = useTranslation("common");
  const { t: tOwn } = useTranslation("ownversion");
  const [value, setValue] = useState("");
  const [own, setOwn] = useState<OwnVersion>(emptyOwnVersion);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ownReady = !ownVersionFirst || ownVersionComplete(own);

  function send() {
    const message = value.trim();
    if (!message || busy || disabled || !ownReady) return;
    if (ownVersionFirst) {
      onSend(message, {
        understanding: own.understanding.trim(),
        uncertain: own.uncertain.trim(),
        proof: own.proof.trim(),
      });
      setOwn(emptyOwnVersion);
    } else {
      onSend(message);
    }
    setValue("");
    ref.current?.focus();
  }

  return (
    <div className="border-t bg-card">
      <div className="mx-auto max-w-(--lp-measure-read) px-4 py-3">
        {disabled && disabledReason && (
          <p role="status" className="mb-2 text-xs leading-ui text-muted-foreground">
            {disabledReason}
          </p>
        )}

        {ownVersionFirst && (
          <div className="mb-3">
            <OwnVersionFields value={own} onChange={setOwn} disabled={disabled} idPrefix="lp-composer-own" />
            {!ownReady && value.trim() !== "" ? (
              <p role="status" className="mt-2 text-xs leading-ui text-muted-foreground">
                {tOwn("fields.required")}
              </p>
            ) : null}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            // Disabled rather than hidden: the affordance is part of what the
            // product is, and hiding it until phase 5 would make the composer
            // silently change shape later.
            disabled
            aria-disabled="true"
            title={t("chat.referencesComingSoon")}
            className="flex size-10 shrink-0 items-center justify-center rounded-md border text-faint"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            <span className="sr-only">{t("chat.addReference")}</span>
          </button>

          <label htmlFor="lp-composer" className="sr-only">
            {t("chat.composerLabel")}
          </label>
          <textarea
            id="lp-composer"
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("chat.placeholder")}
            className={
              "min-h-10 max-h-40 flex-1 resize-y rounded-md border border-control-border bg-background " +
              "px-3 py-2 text-sm leading-ui text-foreground placeholder:text-faint " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            }
          />

          {busy && onStop ? (
            <Button type="button" variant="outline" size="icon" onClick={onStop}>
              <Square aria-hidden="true" />
              <span className="sr-only">{t("chat.stop")}</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={send}
              disabled={busy || disabled || value.trim() === "" || !ownReady}
            >
              <Send aria-hidden="true" />
              <span className="sr-only">{t("chat.send")}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
