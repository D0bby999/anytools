import type { ReactNode } from "react";

/** A heading's anchor: lower-case words joined by hyphens, as VitePress slugs them. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A section whose h2 is numbered "1. …", for a page done in order (P1, P2):
 * a weekly review, an evidence chain, a card's timeline. A page that only
 * lists its parts leaves `n` out (design-world: a number must carry order).
 * The h2 carries an id so the outline and an anchor link can reach it.
 */
export function NumberedSection({
  n,
  title,
  id,
  children,
}: {
  n?: number;
  title: string;
  id?: string;
  children: ReactNode;
}) {
  const anchor = id ?? (n === undefined ? slugify(title) : `${n}-${slugify(title)}`);
  return (
    <section aria-labelledby={anchor}>
      <h2 id={anchor}>
        {n === undefined ? title : `${n}. ${title}`}
      </h2>
      {children}
    </section>
  );
}
