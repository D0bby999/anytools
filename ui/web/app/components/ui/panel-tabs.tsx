import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { sectionTabClass } from "~/components/ui/section-tabs";

export type PanelTab = { id: string; label: string; panel: ReactNode };

/**
 * Tabs inside one page, for several ways of doing one thing (the five ways to
 * add to a knowledge base). Every panel stays mounted and only the chosen one
 * is shown, so a half-typed URL survives a look at another tab.
 *
 * They look like the page-section tabs (section-tabs.tsx): a tinted tab with a
 * full outline, never an underline.
 *
 * The WAI-ARIA tabs pattern: one tab stop for the list, arrow keys, Home and
 * End move between tabs, and activation follows focus.
 */
export function PanelTabs({ tabs, label, initial }: { tabs: PanelTab[]; label: string; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? "");
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(tabs[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b pb-2">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => move(e, i)}
              className={`${sectionTabClass({ isActive: selected })} shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className="mt-5 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:outline-none"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
