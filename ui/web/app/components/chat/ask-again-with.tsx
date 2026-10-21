/**
 * ask-again-with.tsx — ask the last question again with another model on the
 * chat route, for this answer only (plan 261021-1100 phase 5).
 *
 * The composer's chip pins a model to the conversation; this does not. It
 * sits beside "Ask again" under the last answer, as a text action that opens
 * the route's models; picking one asks again with it, and the next question
 * goes back to the conversation's own pick. Offered only when the route has
 * more than one model, since otherwise "Ask again" already says it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelName, type ModelOption } from "~/components/chat/composer/model-chip";

export function AskAgainWith({ models, onPick }: { models: ModelOption[]; onPick: (model: ModelOption) => void }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (models.length < 2) return null;

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {t("chat.askWith.action")}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("chat.askWith.label")}
          className="absolute top-full left-0 z-dropdown mt-1 flex max-h-72 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-xl border bg-card p-2 shadow-md"
        >
          <p className="px-2 pb-1 text-xs leading-5 text-muted-foreground">{t("chat.askWith.help")}</p>
          {models.map((m) => (
            <button
              key={`${m.id}::${m.model}`}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(m);
              }}
              className="flex min-h-8 w-full min-w-0 items-center rounded-md px-2 py-1 text-left text-sm font-medium text-foreground hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
            >
              <ModelName name={m.name} model={m.model} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
