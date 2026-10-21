/**
 * trigger-menu.tsx — the list that opens above the composer for `/` commands
 * and `@` documents (after postclaw's trigger menu).
 *
 * Presentational: the composer keeps the text field focused and drives it as
 * a combobox (aria-controls, aria-activedescendant), so ↑ ↓ choose, Enter or
 * Tab picks, Escape closes, and typing goes on filtering.
 */
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export type TriggerItem = { key: string; label: string; detail?: string; icon?: ReactNode };

export function optionId(menuId: string, i: number): string {
  return `${menuId}-${i}`;
}

export function TriggerMenu({
  id,
  label,
  items,
  active,
  empty,
  onPick,
  onHover,
  placement = "above",
}: {
  id: string;
  label: string;
  items: TriggerItem[];
  active: number;
  /** Said when nothing matches. */
  empty: string;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  /** Above the composer; below a field such as the model picker. */
  placement?: "above" | "below";
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 z-dropdown overflow-hidden rounded-xl border bg-card shadow-md",
        placement === "above" ? "bottom-full mb-2" : "top-full mt-1",
      )}
    >
      <p className="px-3 pt-2 text-xs leading-5 font-semibold text-muted-foreground">{label}</p>
      <ul id={id} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
        {items.map((item, i) => (
          <li
            key={item.key}
            id={optionId(id, i)}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: the text field keeps focus.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm",
              i === active ? "bg-selected text-selected-foreground" : "text-foreground",
            )}
          >
            {item.icon}
            <span className="shrink-0 font-medium">{item.label}</span>
            {item.detail ? <span className="min-w-0 truncate text-muted-foreground">{item.detail}</span> : null}
          </li>
        ))}
        {items.length === 0 ? <li className="px-2 py-1 text-sm text-muted-foreground">{empty}</li> : null}
      </ul>
    </div>
  );
}
