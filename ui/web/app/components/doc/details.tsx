import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * A folded section (I7), VitePress's `details` custom block: advanced
 * options, history, a retrieval trace. The native element, so it opens with
 * Enter or Space and announces its state without help.
 */
export function Details({
  summary,
  children,
  open,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details className={cn("lp-details", className)} open={open}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
