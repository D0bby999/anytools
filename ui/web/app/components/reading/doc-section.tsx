import type { ReactNode } from "react";
import { slugify } from "~/components/doc/numbered-section";
import { cn } from "~/lib/utils";

/**
 * The h2 of `.lp-doc` (doc.css), as classes. The Read pages put forms and
 * button-links under their h2s, and `.lp-doc a` is unlayered CSS that would
 * turn every one of those links into an underlined brand link; so a section
 * here draws its heading itself and keeps `.lp-doc` for its prose.
 */
export const DOC_H2 = "mt-12 mb-4 scroll-mt-20 border-t pt-6 text-2xl leading-8 font-semibold text-balance";

/**
 * A section of a Read page with up's h2 (rule above, 24/32), numbered "1. …"
 * when the page is done in order (pattern P1). `id` is the h2's anchor, so the
 * outline and a link like `#add-sources` reach it.
 */
export function DocSection({
  n,
  title,
  id,
  aside,
  children,
  className,
}: {
  n?: number;
  title: string;
  id?: string;
  /** Sits on the heading's line, right-aligned (a count, a quiet control). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const anchor = id ?? slugify(n ? `${n} ${title}` : title);
  const heading = (
    <h2 id={anchor} className={aside ? "text-2xl leading-8 font-semibold text-balance" : DOC_H2}>
      {n ? `${n}. ` : null}
      {title}
    </h2>
  );
  return (
    <section aria-labelledby={anchor} className={className}>
      {aside ? (
        <div className="mt-12 mb-4 flex scroll-mt-20 flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t pt-6">
          {heading}
          {aside}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}

/** Prose and lists in up's article style (`.lp-doc`); no button-links inside. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("lp-doc", className)}>{children}</div>;
}
