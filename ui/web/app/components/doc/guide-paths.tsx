import type { ReactNode } from "react";
import { Link } from "react-router";
import type { PartId } from "~/lib/parts";

export type GuidePath = { title: ReactNode; description: ReactNode; to: string };
export type GuidePathGroup = {
  id: string;
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  paths: GuidePath[];
  /** up's "external" group: a brand-tinted box, warning-coloured names. */
  external?: boolean;
  /**
   * The textbook part the group belongs to: the box takes the part's tint and
   * outline (the key-concept box) and the kicker becomes the part's tab.
   */
  part?: PartId;
};

/**
 * Guide-paths (P7): up's home-page groups. Each group is a numbered kicker,
 * an h2 and a sentence, over a two-column grid of cards (one column on a
 * phone); each card is a link whose name is set in the action ink.
 */
export function GuidePaths({ groups }: { groups: GuidePathGroup[] }) {
  return (
    <div className="lp-guide-paths">
      {groups.map((group) => {
        const headingId = `guide-${group.id}`;
        return (
          <section
            key={group.id}
            className="lp-guide-path-group"
            data-variant={group.external ? "external" : undefined}
            data-part={group.part}
            aria-labelledby={headingId}
          >
            <div className="lp-guide-path-group-heading">
              <span className={group.part ? "lp-tab justify-self-start" : "lp-kicker"}>{group.kicker}</span>
              <h2 id={headingId}>{group.title}</h2>
              {group.description ? <p>{group.description}</p> : null}
            </div>
            <ul className="lp-guide-path-group-items">
              {group.paths.map((path) => (
                <li key={path.to}>
                  <Link to={path.to} className="lp-guide-path">
                    <strong>{path.title}</strong>
                    {path.description}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
