import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

/**
 * Mastery's sections. Vocabulary and the living books' cards live under
 * Mastery rather than in the rail (DESIGN.md caps the navigation); the count
 * beside each is how many cards are due today — a number, not a streak.
 */
export function MasteryTabs({ vocabDue, bookDue = null }: { vocabDue: number | null; bookDue?: number | null }) {
  const { t } = useTranslation("vocab");
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "inline-flex min-h-11 items-center gap-2 border-b-2 px-1 text-sm transition-colors",
      isActive ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    );
  return (
    <nav aria-label={t("tabs.label")} className="mb-6 flex gap-6 border-b">
      <NavLink to="/mastery" end className={tab}>
        {t("tabs.paths")}
      </NavLink>
      <NavLink to="/mastery/vocabulary" className={tab}>
        {t("tabs.vocabulary")}
        {vocabDue ? (
          <span className="rounded-sm bg-primary-soft px-1.5 font-mono text-2xs tabular-nums">
            {t("tabs.dueBadge", { count: vocabDue })}
          </span>
        ) : null}
      </NavLink>
      <NavLink to="/mastery/book-cards" className={tab}>
        {t("tabs.bookCards")}
        {bookDue ? (
          <span className="rounded-sm bg-primary-soft px-1.5 font-mono text-2xs tabular-nums">
            {t("tabs.dueBadge", { count: bookDue })}
          </span>
        ) : null}
      </NavLink>
    </nav>
  );
}
