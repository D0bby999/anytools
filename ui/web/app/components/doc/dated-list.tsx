import type { ReactNode } from "react";
import { Link } from "react-router";
import { NOTE_JOIN } from "~/lib/sentence";

export type DatedItem = { date?: ReactNode; title: ReactNode; to: string; note?: ReactNode };

/**
 * A dated list (P4), as up's "recent updates": **date** · title — one line.
 * Pass a <DateText> as `date` so it is formatted like every other date.
 */
export function DatedList({ items, label }: { items: DatedItem[]; label?: string }) {
  return (
    <ul className="lp-dated-list" aria-label={label}>
      {items.map((item, i) => (
        <li key={i}>
          {item.date ? (
            <>
              <strong>{item.date}</strong>
              {" · "}
            </>
          ) : null}
          <Link to={item.to}>{item.title}</Link>
          {item.note ? <>{NOTE_JOIN}{item.note}</> : null}
        </li>
      ))}
    </ul>
  );
}
