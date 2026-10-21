import type { ReactNode } from "react";

/**
 * The result of an action (I11), up's `.worksheet-feedback`: one polite line
 * right under the buttons, never a floating toast. Always rendered, so a
 * screen reader hears the text the moment it changes.
 */
export function StatusLine({ children, tone = "info" }: { children?: ReactNode; tone?: "info" | "error" }) {
  return (
    <p className="lp-status-line" role="status" data-tone={tone === "error" ? "error" : undefined}>
      {children}
    </p>
  );
}
