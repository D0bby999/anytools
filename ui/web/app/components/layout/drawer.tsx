import { useEffect, useState, type RefObject } from "react";
import { useLocation } from "react-router";
import { useInertOutside, useModalFocus } from "~/components/layout/modal-layer";
import { cn } from "~/lib/utils";

/** Below 960 the sidebar is a drawer; from 960 a column (VitePress's breakpoint). */
const WIDE = "(min-width: 960px)";

/**
 * Whether the viewport is below 960. Unknown on the server and in a browser
 * without matchMedia, where it reports narrow only after mount, so the first
 * render matches the server's.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setNarrow(true);
      return;
    }
    const wide = window.matchMedia(WIDE);
    const update = () => setNarrow(!wide.matches);
    update();
    wide.addEventListener("change", update);
    return () => wide.removeEventListener("change", update);
  }, []);
  return narrow;
}

/**
 * The drawer's behaviour, from `up`'s a11y patches: while open the rest of the
 * app is inert and its scroll region still, focus moves into the drawer and
 * Tab stays there, Escape closes it and focus returns to the Menu button. A
 * navigation closes it, and so does widening the window past 960.
 */
export function useDrawer({
  open,
  onClose,
  layer,
  initial,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  layer: RefObject<HTMLElement | null>;
  initial: RefObject<HTMLElement | null>;
  returnTo?: RefObject<HTMLElement | null>;
}) {
  const narrow = useNarrow();
  const { pathname } = useLocation();
  const active = open && narrow;
  useInertOutside(active, layer);
  useModalFocus(active, layer, onClose, { initial, returnTo });

  useEffect(() => {
    if (open) onClose();
    // Only on navigation: closing must not re-run when `open` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (open && !narrow) onClose();
  }, [open, narrow, onClose]);

  return { narrow, active };
}

/**
 * VPBackdrop: the dimmed page behind the drawer, a click on it closes. Fades
 * in over 500ms and out over 250ms.
 */
export function Backdrop({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <div
      aria-hidden="true"
      onClick={onClick}
      className={cn(
        "fixed inset-0 z-(--lp-z-backdrop) bg-[var(--lp-backdrop)] min-[960px]:hidden",
        show ? "visible opacity-100 transition-opacity duration-500" : "invisible opacity-0 transition-[opacity,visibility] duration-250",
      )}
    />
  );
}
