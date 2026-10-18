import * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Alert carries role="alert" so a sign-in failure is announced to screen
 * readers rather than only appearing visually — the error is the one piece of
 * information a blocked user needs.
 */
const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }
>(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(
      "rounded-md border px-4 py-3 text-sm",
      variant === "destructive"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "bg-muted text-foreground",
      className,
    )}
    {...props}
  />
));
Alert.displayName = "Alert";

export { Alert };
