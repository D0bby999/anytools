import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type BadgeType = "info" | "tip" | "warning" | "danger";

/** A badge (I6): VPBadge. Processing, Ready, Failed, Due, Correct, Draft. */
export function Badge({ type = "info", children, className }: { type?: BadgeType; children: ReactNode; className?: string }) {
  return (
    <span className={cn("lp-badge", className)} data-type={type}>
      {children}
    </span>
  );
}
