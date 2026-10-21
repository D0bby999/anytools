import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * A pill switch after VitePress's VPSwitch (pattern I10), on the 4pt scale:
 * 40×24, fully rounded, a 1px control border that turns brand on hover, and a
 * 20px knob that slides 16px when on. `children` is the knob's icon (12px), as the appearance switch puts
 * a sun or a moon there.
 *
 * A real `role="switch"` button, so it is reached by Tab and toggled by Space
 * and Enter; the name comes from `aria-label` or `aria-labelledby`, or from
 * the visible `label` set to its left (14/500).
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  children,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: ReactNode;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role">) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative block h-6 w-10 shrink-0 rounded-full border border-control-border bg-hover transition-[border-color] duration-250 hover:border-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-px left-px flex size-5 items-center justify-center overflow-hidden rounded-full bg-card shadow-sm transition-transform duration-250 motion-reduce:transition-none",
          "text-muted-foreground [&_svg]:size-3",
          checked && "translate-x-4 text-foreground",
        )}
      >
        {children}
      </span>
    </button>
  );
  if (!label) return button;
  return (
    <label className="flex items-center justify-between gap-4 text-sm font-medium">
      {label}
      {button}
    </label>
  );
}
