import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * A flyout menu, VitePress's VPFlyout + VPMenu (pattern I9): a 14/500 text or
 * icon button with a chevron, opening a menu card (radius 12, 1px border,
 * surface, raised shadow, padding 12) whose rows are 32 high, padding 0 12,
 * radius 6, with a hover tint.
 *
 * Unlike VitePress it does not open on hover: a menu that appears under a
 * passing pointer and says aria-expanded="false" meanwhile is a lie to a
 * screen reader. It opens on click, Enter and Space; Escape closes it and
 * returns focus to the button; so do a click outside, focus leaving it and a
 * navigation.
 */
export function Flyout({
  label,
  icon,
  children,
  className,
  buttonClassName,
  menuClassName,
  hideChevron,
}: {
  /** The button's accessible name; shown as text unless an icon is given. */
  label: string;
  /** Replaces the visible text (the language globe, the avatar, "…"). */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  hideChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { pathname, search } = useLocation();

  useEffect(() => setOpen(false), [pathname, search]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className={cn("relative", className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-(--lp-topbar-h) items-center px-3 text-sm font-medium text-foreground transition-colors hover:text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
          buttonClassName,
        )}
      >
        {icon ? (
          <>
            {icon}
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
        {hideChevron ? null : <ChevronDown aria-hidden="true" className="ml-1 size-3.5" />}
      </button>
      <div
        id={menuId}
        hidden={!open}
        className={cn(
          "absolute top-[calc(var(--lp-topbar-h)/2+20px)] right-0 z-dropdown max-h-[calc(100dvh-var(--lp-topbar-h))] min-w-32 overflow-y-auto rounded-xl border bg-card p-3 shadow-md",
          menuClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** One row of a flyout menu: 14/500, 32 high, radius 6, hover tint. */
export const FLYOUT_ITEM =
  "flex min-h-8 w-full items-center gap-2 rounded-sm px-3 text-left text-sm leading-8 font-medium whitespace-nowrap text-foreground transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** A row that goes somewhere; `external` for a page outside the app's router. */
export function FlyoutLink({
  to,
  external,
  active,
  children,
}: {
  to: string;
  external?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  const className = cn(FLYOUT_ITEM, active && "text-primary");
  return external ? (
    <a href={to} className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** A group's title inside a menu (the current language, the account's name). */
export function FlyoutTitle({ children }: { children: ReactNode }) {
  return <p className="px-3 text-sm leading-8 font-semibold text-foreground">{children}</p>;
}

/** A group of rows, ruled off from the group before it as VPMenu does. */
export function FlyoutGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("-mx-3 px-3 [&+&]:mt-3 [&+&]:border-t [&+&]:pt-3", className)}>{children}</div>;
}
