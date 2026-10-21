import type { ReactNode } from "react";
import { slugify } from "~/components/doc/numbered-section";

/**
 * A numbered section (P1, P2) whose body is a form or a live panel rather
 * than prose. Only the heading takes the article's prose rules (`lp-doc`);
 * wrapping a form in them would give every hint and status line the 18px
 * paragraph margins, which the library's own NumberedSection cannot avoid.
 */
export function DocSection({
  n,
  title,
  id,
  children,
}: {
  /** Leave out for an unnumbered section ("Earlier reports"). */
  n?: number;
  title: string;
  id?: string;
  children: ReactNode;
}) {
  const anchor = id ?? (n !== undefined ? `${n}-${slugify(title)}` : slugify(title));
  return (
    <section aria-labelledby={anchor}>
      <div className="lp-doc">
        <h2 id={anchor}>{n !== undefined ? `${n}. ${title}` : title}</h2>
      </div>
      {children}
    </section>
  );
}
