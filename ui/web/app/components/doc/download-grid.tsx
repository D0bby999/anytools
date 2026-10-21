import type { ReactNode } from "react";

export type DownloadCard = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** The action: a link, a form button. Draw it with `lp-download-action`. */
  action: ReactNode;
  details?: ReactNode;
};

/** A download grid (P6): up's Download Center, two cards a row, one on a phone. */
export function DownloadGrid({ cards }: { cards: DownloadCard[] }) {
  return (
    <div className="lp-download-grid">
      {cards.map((card) => (
        <section key={card.id} className="lp-download-card" aria-labelledby={`dl-${card.id}`}>
          <h2 id={`dl-${card.id}`}>{card.title}</h2>
          {card.description ? <p>{card.description}</p> : null}
          {card.action}
          {card.details}
        </section>
      ))}
    </div>
  );
}
