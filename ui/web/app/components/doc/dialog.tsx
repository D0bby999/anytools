import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog (I12) in the frame of VPLocalSearchBox: the page dimmed behind it,
 * a 560px box 64px from the top (the whole screen below 768), the actions
 * at the end, right-aligned. Confirming a delete, choosing a Drive file.
 *
 * While open, everything else on the page is `inert`, Tab and Shift+Tab stay
 * inside, Esc and a click on the dimmed page close it, and the focus goes
 * back to whatever opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const host = portal.current;
    // Everything but this dialog leaves the tab order and the a11y tree.
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== host && !el.inert,
    );
    for (const el of others) el.inert = true;

    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? box.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab" || !box.current) return;
      const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of others) el.inert = false;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={portal}>
      <div
        className="lp-dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) close.current();
        }}
      >
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-desc` : undefined}
          tabIndex={-1}
          className="lp-dialog"
        >
          <h2 id={`${id}-title`} className="lp-dialog-title">
            {title}
          </h2>
          {description ? (
            <p id={`${id}-desc`} className="m-0 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
          {children}
          {actions ? <div className="lp-dialog-actions">{actions}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
