/**
 * until-found.tsx — folding without unmounting (postclaw's, unchanged in
 * substance).
 *
 * A fold is `hidden="until-found"`, not an unmount, for two reasons:
 * 1. The browser's find-in-page still reaches folded text: Chromium matches
 *    inside the subtree, reveals it and fires `beforematch`, which unfolds it
 *    here. Elsewhere the attribute degrades to plain hidden, and the
 *    conversation's own search (search-bar.tsx) opens the fold instead.
 * 2. A step that is still streaming keeps its state when folded.
 *
 * The attribute is set imperatively: React renders `hidden` as a boolean, so
 * `hidden="until-found"` as a prop would become `hidden=""`, plain
 * `display: none`.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function UntilFound({
  open,
  onReveal,
  foldKey,
  className,
  children,
}: {
  open: boolean;
  /** Called when a find match lands inside the folded subtree. */
  onReveal?: () => void;
  /** The fold this subtree belongs to; the conversation search opens it by this. */
  foldKey?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "until-found");
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el || open || !onReveal) return;
    const handler = () => onReveal();
    el.addEventListener("beforematch", handler);
    return () => el.removeEventListener("beforematch", handler);
  }, [open, onReveal]);

  return (
    <div ref={ref} data-fold-key={foldKey} data-folded={open ? undefined : "until-found"} className={className}>
      {children}
    </div>
  );
}
