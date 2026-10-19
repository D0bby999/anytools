import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { OwnVersionFields } from "~/components/chat/own-version-fields";
import { emptyOwnVersion, ownVersionComplete, type OwnVersion } from "~/lib/own-version";

/** One entry of the chat route the conversation can be pinned to. */
export type ModelOption = { id: string; name: string; model: string };

/** An entry's value in the menu: a route may hold one connection twice. */
export function modelKey(m: { id: string; model: string }): string {
  return `${m.id}::${m.model}`;
}

/** The most messages that can wait behind a running turn. */
export const MAX_QUEUED = 3;

const MAX_HEIGHT = 160;

/**
 * The composer.
 *
 * Enter sends; Shift+Enter is a newline; the box grows with what is typed, up
 * to a few lines. Esc stops a running turn.
 *
 * While a turn runs, Enter queues the message instead (up to MAX_QUEUED,
 * postclaw's message queue): the queue is shown above the box, each item
 * removable, and the route sends them one by one as turns finish. A turn that
 * fails or is stopped pauses the queue rather than sending into a problem.
 *
 * The draft is kept per conversation in this browser (`draftKey`), so leaving
 * the page or reloading it does not lose a half-written question.
 *
 * With "write my own version first" on (up-methods phase 11), three lines sit
 * above the message and Send waits until all three are written; the server
 * refuses the turn without them anyway. Queueing is off then: the three lines
 * belong to one question at a time.
 *
 * Below the box: the model the conversation uses, picked from the learner's
 * chat route, and the keyboard hint.
 */
export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
  disabledReason,
  ownVersionFirst = false,
  draftKey,
  queued = [],
  onQueue,
  onUnqueue,
  models,
  model,
  onModel,
}: {
  onSend: (message: string, ownVersion?: OwnVersion) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** The learner's "write my own version first" switch. */
  ownVersionFirst?: boolean;
  /** Where the draft is kept; no key keeps none. */
  draftKey?: string;
  /** Messages waiting behind the running turn. */
  queued?: string[];
  onQueue?: (message: string) => void;
  onUnqueue?: (index: number) => void;
  /** The chat route's connections; fewer than two hides the picker. */
  models?: ModelOption[];
  /** The pinned entry's modelKey, or "" for the route's own order. */
  model?: string;
  onModel?: (key: string) => void;
}) {
  const { t } = useTranslation("common");
  const { t: tOwn } = useTranslation("ownversion");
  const [value, setValue] = useState("");
  const [own, setOwn] = useState<OwnVersion>(emptyOwnVersion);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ownReady = !ownVersionFirst || ownVersionComplete(own);
  const canQueue = busy && !!onQueue && !ownVersionFirst && queued.length < MAX_QUEUED;

  // The draft: read once the page is in a browser, written on every change.
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setValue(saved);
    } catch {
      // Storage refused (private mode, quota): the draft is just not kept.
    }
  }, [draftKey]);

  function change(next: string) {
    setValue(next);
    if (!draftKey) return;
    try {
      if (next === "") window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, next);
    } catch {
      // As above.
    }
  }

  // Grow with the text, to MAX_HEIGHT, then scroll inside.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "auto";
    // scrollHeight leaves out the border, which a border-box height includes;
    // without it the box is two pixels short and shows a scrollbar.
    const full = box.scrollHeight + box.offsetHeight - box.clientHeight;
    box.style.height = `${Math.min(full, MAX_HEIGHT)}px`;
    box.style.overflowY = full > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  function send() {
    const message = value.trim();
    if (!message || disabled || !ownReady) return;
    if (busy) {
      if (!canQueue) return;
      onQueue?.(message);
      change("");
      return;
    }
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
    change("");
    ref.current?.focus();
  }

  const head = models?.[0];
  const showPicker = !!models && !!head && models.length > 1 && !!onModel;

  return (
    <div className="border-t bg-card">
      <div className="mx-auto max-w-(--lp-measure-read) px-4 py-3">
        {disabled && disabledReason && (
          <p role="status" className="mb-2 text-xs leading-ui text-muted-foreground">
            {disabledReason}
          </p>
        )}

        {queued.length > 0 && (
          <div className="mb-2">
            <p className="text-xs leading-ui text-muted-foreground">{t("chat.queue.title", { count: queued.length })}</p>
            <ol className="mt-1 flex flex-col gap-1">
              {queued.map((q, i) => (
                <li key={`${i}-${q}`} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">{q}</span>
                  {onUnqueue && (
                    <button
                      type="button"
                      onClick={() => onUnqueue(i)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <X className="size-4" aria-hidden="true" />
                      <span className="sr-only">{t("chat.queue.remove", { message: q })}</span>
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </div>
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
          <label htmlFor="lp-composer" className="sr-only">
            {t("chat.composerLabel")}
          </label>
          <textarea
            id="lp-composer"
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && busy && onStop) {
                e.preventDefault();
                onStop();
              }
            }}
            placeholder={busy && canQueue ? t("chat.queue.placeholder") : t("chat.placeholder")}
            className={
              "min-h-10 flex-1 resize-none rounded-md border border-control-border bg-card " +
              "px-3 py-2 text-sm leading-ui text-foreground placeholder:text-faint " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            }
          />

          {busy && onStop && value.trim() === "" ? (
            <Button type="button" variant="outline" size="icon" onClick={onStop}>
              <Square aria-hidden="true" />
              <span className="sr-only">{t("chat.stop")}</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={send}
              disabled={(busy && !canQueue) || disabled || value.trim() === "" || !ownReady}
            >
              <Send aria-hidden="true" />
              <span className="sr-only">{busy ? t("chat.queue.add") : t("chat.send")}</span>
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {showPicker ? (
            <label className="flex min-w-0 items-center gap-2 text-xs leading-ui text-muted-foreground">
              {t("chat.model.label")}
              <select
                value={model ?? ""}
                disabled={busy}
                onChange={(e) => onModel?.(e.target.value)}
                className="h-8 min-w-0 max-w-64 truncate rounded-md border border-control-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <option value="">{t("chat.model.default", { name: head?.name, model: head?.model })}</option>
                {models?.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.model ? `${m.name} · ${m.model}` : m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <p className="hidden text-xs leading-ui text-muted-foreground sm:block">
            {busy && onStop ? t("chat.hintBusy") : t("chat.hint")}
          </p>
        </div>
      </div>
    </div>
  );
}
