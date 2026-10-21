/**
 * live-label.tsx — a label that is still being produced (postclaw's
 * ChatTextShimmer). The span stays mounted when the step ends and only its
 * `data-live` flips, so the label does not remount; the highlight is in
 * app.css (`.lp-live-label`) and stops under reduced motion.
 */
import { memo, useMemo, type CSSProperties } from "react";
import { cn } from "~/lib/utils";

export const LiveLabel = memo(function LiveLabel({
  children,
  live,
  className,
}: {
  children: string;
  live: boolean;
  className?: string;
}) {
  const style = useMemo(() => ({ "--lp-live-spread": `${children.length * 8}px` }) as CSSProperties, [children.length]);
  return (
    <span className={cn("lp-live-label", className)} style={style} data-live={live ? "" : undefined}>
      {children}
    </span>
  );
});
