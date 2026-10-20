import { useTranslation } from "react-i18next";
import { BookmarkPlus, Flag, Highlighter, Mic, Shapes, Volume2, X } from "lucide-react";
import type { ReaderSelection } from "~/lib/reading-selection";
import type { ReadingAction } from "~/lib/reading-types";
import { Button } from "~/components/ui/button";

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
  /** Record yourself reading the selection (plans/261020-1155-open-source-adds, phase 2). */
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
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-lg border bg-card p-2 shadow-sm"
      >
        <span className="sr-only">
          {t("toolbar.selected")} {selection.page > 0 ? t("toolbar.onPage", { page: selection.page }) : ""}
        </span>
        {actions.map(({ action, label }) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "explain" ? "default" : "ghost"}
            disabled={busy}
            onPointerDown={keep}
            onClick={() => onAction(action)}
          >
            {label}
          </Button>
        ))}
        {onDraw ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onPointerDown={keep} onClick={onDraw}>
            <Shapes aria-hidden="true" />
            {t("actions.draw")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onPointerDown={keep} onClick={onHighlight}>
          <Highlighter aria-hidden="true" />
          {t("actions.highlight")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onPointerDown={keep} onClick={onSave}>
          <BookmarkPlus aria-hidden="true" />
          {t("actions.save")}
        </Button>
        {onMarkBarrier ? (
          <Button type="button" size="sm" variant="ghost" onPointerDown={keep} onClick={onMarkBarrier}>
            <Flag aria-hidden="true" />
            {t("passes.markBarrier")}
          </Button>
        ) : null}
        {onReadAloud ? (
          <Button type="button" size="sm" variant="ghost" onPointerDown={keep} onClick={onReadAloud}>
            <Volume2 aria-hidden="true" />
            {t("actions.readAloud")}
          </Button>
        ) : null}
        {onCheckAloud ? (
          <Button type="button" size="sm" variant="ghost" onPointerDown={keep} onClick={onCheckAloud}>
            <Mic aria-hidden="true" />
            {t("actions.checkAloud")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("toolbar.dismiss")}
          onPointerDown={keep}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
