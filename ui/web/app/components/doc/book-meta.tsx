import type { ReactNode } from "react";
import { Link } from "react-router";

export type BookMetaItem = { label: ReactNode; to?: string };

/**
 * Book-meta (I5): a line of facts split by 1px rules, as up's `.book-meta`.
 * A list, so a screen reader counts the facts instead of reading one run-on line.
 */
export function BookMeta({ items, label }: { items: BookMetaItem[]; label: string }) {
  return (
    <ul className="lp-book-meta" aria-label={label}>
      {items.map((item, i) => (
        <li key={i}>{item.to ? <Link to={item.to}>{item.label}</Link> : item.label}</li>
      ))}
    </ul>
  );
}
