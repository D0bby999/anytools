/**
 * modal-layer.ts
 * What every layer that covers the page needs (the phone's nav screen, the
 * sidebar drawer, the search modal), ported from the a11y patches `up` adds to
 * VitePress (LocalizedA11yLabels.vue): everything outside the layer is
 * `inert`, Tab stays inside it, Escape closes it, the scroll region behind it
 * stops scrolling, and focus goes back where it came from.
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && !el.hidden);
}

/**
 * While `open`, every element outside `keep` (walking up to <body>) is inert,
 * and the shell's scroll region is locked. Restores exactly what it changed.
 */
export function useInertOutside(open: boolean, keep: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const layer = keep.current;
    if (!open || !layer) return;
    const changed: HTMLElement[] = [];
    for (let el: HTMLElement | null = layer; el && el !== document.body; el = el.parentElement) {
      for (const sibling of el.parentElement?.children ?? []) {
        // The attribute rather than the property: it is what CSS, the
        // accessibility tree and jsdom all read.
        if (sibling === el || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert")) continue;
        // Scripts, styles and the live-region announcer carry nothing to reach.
        if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
        sibling.setAttribute("inert", "");
        changed.push(sibling);
      }
    }
    const scroller = document.querySelector<HTMLElement>("[data-lp-scroll]");
    const overflow = scroller?.style.overflow ?? "";
    if (scroller) scroller.style.overflow = "hidden";
    return () => {
      for (const el of changed) el.removeAttribute("inert");
      if (scroller) scroller.style.overflow = overflow;
    };
  }, [open, keep]);
}

/**
 * Escape closes; Tab wraps inside `layer`. Focus moves into the layer on open
 * (`initial`, else its first focusable) and back to `returnTo` (else whatever
 * had it before) on close.
 */
export function useModalFocus(
  open: boolean,
  layer: RefObject<HTMLElement | null>,
  onClose: () => void,
  { initial, returnTo }: { initial?: RefObject<HTMLElement | null>; returnTo?: RefObject<HTMLElement | null> } = {},
) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = layer.current;
    (initial?.current ?? (el ? focusables(el)[0] : null) ?? el)?.focus();

    function onKey(e: KeyboardEvent) {
      const root = layer.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = returnTo?.current ?? previous;
      // After the inert attributes come off (same commit), so the element
      // can take focus again.
      queueMicrotask(() => back?.focus());
    };
  }, [open, layer, initial, returnTo]);
}
