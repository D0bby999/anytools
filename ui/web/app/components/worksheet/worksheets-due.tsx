import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { DueReview } from "~/lib/worksheet-types";

/** What Home shows of the due list: counts only, private notes apart. */
export type DueCounts = { count: number; private: number };

/**
 * dueCounts splits the due list for Home: reviews of shared worksheets, and
 * private notes to revisit, each private worksheet once (phase 9). Nothing
 * else of the list, no title or kind, reaches Home.
 */
export function dueCounts(d: { due: DueReview[] }): DueCounts {
  const privateIds = new Set(d.due.filter((r) => r.private).map((r) => r.id));
  return { count: d.due.filter((r) => !r.private).length, private: privateIds.size };
}

/**
 * Home's "To revisit today" (up methods, phase 0): worksheet reviews due on
 * the learner's local day or earlier, as a count linking to /toolkit. Shown
 * only when something is due. Titles are not listed here; /toolkit lists
 * them, with a private worksheet's title replaced by "Private note". A
 * private worksheet is counted on its own line, "1 private note to revisit"
 * (phase 9).
 */
export function WorksheetsDue({ count, private: privateCount = 0 }: { count: number; private?: number }) {
  const { t } = useTranslation("toolkit");
  if (count <= 0 && privateCount <= 0) return null;
  return (
    <section aria-labelledby="lp-worksheets-home">
      <h3 id="lp-worksheets-home" className="font-sans text-sm font-semibold">
        {t("home.title")}
      </h3>
      {count > 0 ? <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t("home.count", { count })}</p> : null}
      {privateCount > 0 ? (
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {t("life.homePrivate", { count: privateCount })}
        </p>
      ) : null}
      <Link to="/toolkit" className="mt-1 inline-block relative text-sm leading-6 font-medium text-primary underline underline-offset-4 hover:text-primary-hover after:absolute after:inset-x-0 after:-inset-y-3">
        {t("home.open")}
      </Link>
    </section>
  );
}
