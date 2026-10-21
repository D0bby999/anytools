import { useTranslation } from "react-i18next";
import { BookmarkPlus, Flag, Highlighter, Mic, Shapes, Volume2, X } from "lucide-react";
import type { ReaderSelection } from "~/lib/reading-selection";
import type { ReadingAction } from "~/lib/reading-types";
import { FLYOUT_ITEM } from "~/components/doc/flyout";
import { cn } from "~/lib/utils";

/**
 * The actions on a selection, as a bar pinned to the bottom of the viewport.
 *
 * Pinned rather than floated beside the selection: phones draw their own copy
 * menu right there, and a bar in a fixed place is also where a keyboard or
 * screen-reader user can find it again. It sits above the phone's bottom nav.
 *
 * `onPointerDown` prevents the default so pressing a button does not collapse
 * the selection it is about to act on.
 */
/** A row of the floating menu: the flyout row, sized to its words. */
const ITEM = cn(FLYOUT_ITEM, "w-auto disabled:opacity-50");

export function SelectionToolbar({
  selection,
  busy,
  onAction,
  onHighlight,
  onSave,
  onDraw,
  onDismiss,
  onReadAloud,
  onCheckAloud,
  onMarkBarrier,
}: {
  selection: ReaderSelection;
  busy: boolean;
  onAction: (action: ReadingAction) => void;
  onHighlight: () => void;
  onSave: () => void;
  /** "Draw it" on the selection (learning depth, phase 5). */
  onDraw?: () => void;
  onDismiss: () => void;
  /** Learning depth, phase 7: read the selection aloud (browser voices). */
  onReadAloud?: () => void;
  /** Record yourself reading the selection (the private design notes, phase 2). */
  onCheckAloud?: () => void;
  /** up-methods phase 5: a row in the reading card's barrier map, from this selection and its page. */
  onMarkBarrier?: () => void;
}) {
  const { t } = useTranslation("reading");
  const keep = (event: React.PointerEvent) => event.preventDefault();

  const actions: { action: ReadingAction; label: string }[] = [
    { action: "explain", label: t("actions.explain") },
    { action: "vocab", label: t("actions.vocab") },
    { action: "quiz", label: t("actions.quiz") },
    { action: "translate", label: t("actions.translate") },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-popover flex justify-center px-4 lg:bottom-6">
      <div
        role="toolbar"
        aria-label={t("toolbar.label")}
        // A flyout menu (I9) that floats: radius 12, 1px border, the raised
        // shadow, padding 12, rows 32 high with a hover tint.
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-card p-3 shadow-md"
      >
        <span className="sr-only">
          {t("toolbar.selected")} {selection.page > 0 ? t("toolbar.onPage", { page: selection.page }) : ""}
        </span>
        {actions.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            className={cn(ITEM, action === "explain" && "text-primary")}
            disabled={busy}
            onPointerDown={keep}
            onClick={() => onAction(action)}
          >
            {label}
          </button>
        ))}
        {onDraw ? (
          <button type="button" className={ITEM} disabled={busy} onPointerDown={keep} onClick={onDraw}>
            <Shapes aria-hidden="true" className="size-4" />
            {t("actions.draw")}
          </button>
        ) : null}
        <button type="button" className={ITEM} disabled={busy} onPointerDown={keep} onClick={onHighlight}>
          <Highlighter aria-hidden="true" className="size-4" />
          {t("actions.highlight")}
        </button>
        <button type="button" className={ITEM} disabled={busy} onPointerDown={keep} onClick={onSave}>
          <BookmarkPlus aria-hidden="true" className="size-4" />
          {t("actions.save")}
        </button>
        {onMarkBarrier ? (
          <button type="button" className={ITEM} onPointerDown={keep} onClick={onMarkBarrier}>
            <Flag aria-hidden="true" className="size-4" />
            {t("passes.markBarrier")}
          </button>
        ) : null}
        {onReadAloud ? (
          <button type="button" className={ITEM} onPointerDown={keep} onClick={onReadAloud}>
            <Volume2 aria-hidden="true" className="size-4" />
            {t("actions.readAloud")}
          </button>
        ) : null}
        {onCheckAloud ? (
          <button type="button" className={ITEM} onPointerDown={keep} onClick={onCheckAloud}>
            <Mic aria-hidden="true" className="size-4" />
            {t("actions.checkAloud")}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(ITEM, "px-2")}
          aria-label={t("toolbar.dismiss")}
          onPointerDown={keep}
          onClick={onDismiss}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
