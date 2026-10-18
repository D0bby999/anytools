import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * The top of every page in the textbook world: the title in the book face, a
 * lede in the interface face, and the page's own actions to the right.
 *
 * `numeral` is the chapter numeral (lp-numeral), in the part's colour. Pass it
 * only when the number carries information: a chapter's position, a week, a
 * count. A decorative "01" is refused by the world (DESIGN.md).
 *
 * The header is the page's one entrance (lp-page-enter); nothing else on a
 * page animates in.
 */
export function PageHeader({
  title,
  lede,
  numeral,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  lede?: ReactNode;
  numeral?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("lp-page-enter mb-8 flex flex-wrap items-start gap-x-6 gap-y-4", className)}>
      {numeral != null ? (
        <span aria-hidden="true" className="lp-numeral -mt-1 shrink-0">
          {numeral}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="text-3xl leading-tight break-words lg:text-4xl">{title}</h1>
        {lede ? <div className="mt-3 max-w-[64ch] text-lg leading-snug text-muted-foreground">{lede}</div> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
