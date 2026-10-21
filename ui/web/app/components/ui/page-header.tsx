import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * The top of every page, as up opens a chapter: the h1 at up's scale (42px,
 * 22ch, balanced; 32px on a phone, `lp-h1` in doc.css), one lede in
 * secondary ink at 16/1.85, and the page's own actions in a row under it.
 *
 * The h1 carries an id so the outline and an anchor link can reach it.
 *
 * `numeral` (the textbook world's chapter numeral) is accepted and not drawn:
 * up has none. Phase 15 decides whether it comes back.
 */
export function PageHeader({
  title,
  lede,
  actions,
  children,
  className,
  id = "page-title",
}: {
  title: ReactNode;
  lede?: ReactNode;
  numeral?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <header className={cn("mb-8", className)}>
      <h1 id={id} className="lp-h1 break-words">
        {title}
      </h1>
      {lede ? <div className="mt-4 text-base leading-[1.85] text-muted-foreground">{lede}</div> : null}
      {children}
      {actions ? <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">{actions}</div> : null}
    </header>
  );
}
