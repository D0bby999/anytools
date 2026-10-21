import * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Alert carries role="alert" so a sign-in failure is announced to screen
 * readers rather than only appearing visually — the error is the one piece of
 * information a blocked user needs.
 *
 * Drawn as a VitePress custom block (custom-block.css): a 1px transparent
 * outline, the card radius, 16px 16px 8px inside, 14/24 text on the state's
 * soft fill. Never a coloured rule down one side.
 */
const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "warning" | "destructive" }
>(({ className, variant = "default", children, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(
      "rounded-lg border border-transparent px-4 pt-4 pb-2 text-sm leading-6 text-foreground",
      variant === "destructive" ? "bg-destructive-soft" : variant === "warning" ? "bg-warning-soft" : "bg-hover",
      className,
    )}
    {...props}
  >
    {/* The block's own 8px below its last line, as VitePress's last <p> gives. */}
    <div className="mb-2">{children}</div>
  </div>
));
Alert.displayName = "Alert";

/** The block's title line: 14px at 600, as VitePress's `.custom-block-title`. */
function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("font-semibold", className)} {...props} />;
}

export { Alert, AlertTitle };
