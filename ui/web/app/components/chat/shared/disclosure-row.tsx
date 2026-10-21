/**
 * disclosure-row.tsx — one row that folds what is under it (postclaw's
 * DisclosureRow): a caret, an icon, the label and an optional quiet summary,
 * as one button with `aria-expanded`. Quiet by design: it is the answer's
 * margin note, not the answer.
 */
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";

export function DisclosureRow({
  expanded,
  onToggle,
  controls,
  icon,
  label,
  summary,
  tone = "default",
  testId,
}: {
  expanded: boolean;
  onToggle: () => void;
  /** The id of the region this row folds. */
  controls?: string;
  icon?: ReactNode;
  label: ReactNode;
  summary?: ReactNode;
  tone?: "default" | "error";
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      data-testid={testId}
      className={cn(
        "flex min-h-8 w-full max-w-full min-w-0 items-center gap-2 rounded-md text-left text-sm leading-6 font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        tone === "error" ? "text-destructive" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", expanded && "rotate-90")}
      />
      {icon}
      <span className="min-w-0 truncate">
        {label}
        {summary ? (
          <>
            {" "}
            <span className="font-normal">· {summary}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}
