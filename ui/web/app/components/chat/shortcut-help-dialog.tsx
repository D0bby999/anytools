/**
 * shortcut-help-dialog.tsx — the conversation page's keys, opened with `?`
 * (after postclaw's shortcut help). Mod reads as ⌘ on a Mac, Ctrl elsewhere.
 */
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useInertOutside, useModalFocus } from "~/components/layout/modal-layer";
import { Button } from "~/components/ui/button";
import { isMac, SHORTCUTS } from "~/lib/chat-shortcuts";

export function ShortcutHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("common");
  const layer = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useInertOutside(open, layer);
  useModalFocus(open, layer, onClose);
  if (!open || typeof document === "undefined") return null;
  const mod = isMac() ? "⌘" : "Ctrl";

  return createPortal(
    <div ref={layer} className="fixed inset-0 z-[100] flex items-start justify-center p-4 sm:items-center">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-[var(--lp-backdrop)]" />
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative mt-16 w-full max-w-md rounded-xl bg-background p-6 shadow-md sm:mt-0">
        <h2 id={titleId} className="font-serif text-xl leading-7 font-semibold">
          {t("chat.shortcuts.title")}
        </h2>
        <dl className="mt-4 flex flex-col gap-2 text-sm leading-6">
          {SHORTCUTS.map((s) => (
            <div key={s.labelKey} className="flex items-center justify-between gap-4">
              <dt className="text-foreground">{t(s.labelKey)}</dt>
              <dd className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="min-w-6 rounded-sm border bg-sunken px-1.5 text-center font-mono text-xs leading-6">
                    {k === "Mod" ? mod : k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("chat.shortcuts.close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
