import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { sectionTabClass, SECTION_TABS_ROW } from "~/components/ui/section-tabs";

/**
 * Mastery's sections. Vocabulary and the living books' cards live under
 * Mastery rather than in the rail (DESIGN.md caps the navigation); the count
 * beside each is how many cards are due today — a number, not a streak.
 */
export function MasteryTabs({
  vocabDue,
  bookDue = null,
  deckDue = null,
}: {
  vocabDue: number | null;
  bookDue?: number | null;
  deckDue?: number | null;
}) {
  const { t } = useTranslation("vocab");
  const tab = sectionTabClass;
  return (
    <nav aria-label={t("tabs.label")} className={SECTION_TABS_ROW}>
      <NavLink to="/mastery" end className={tab}>
        {t("tabs.paths")}
      </NavLink>
      <NavLink to="/mastery/review" className={tab}>{t("practise.review")}</NavLink>
      <NavLink to="/mastery/vocabulary" className={tab}>
        {t("tabs.vocabulary")}
        {vocabDue ? (
          <span className="rounded-sm bg-highlight px-2 text-xs font-semibold text-highlight-foreground tabular-nums">
            {t("tabs.dueBadge", { count: vocabDue })}
          </span>
        ) : null}
      </NavLink>
      <NavLink to="/mastery/book-cards" className={tab}>
        {t("tabs.bookCards")}
        {bookDue ? (
          <span className="rounded-sm bg-highlight px-2 text-xs font-semibold text-highlight-foreground tabular-nums">
            {t("tabs.dueBadge", { count: bookDue })}
          </span>
        ) : null}
      </NavLink>
      <NavLink to="/mastery/decks" className={tab}>
        {t("tabs.decks")}
        {deckDue ? (
          <span className="rounded-sm bg-highlight px-2 text-xs font-semibold text-highlight-foreground tabular-nums">
            {t("tabs.dueBadge", { count: deckDue })}
          </span>
        ) : null}
      </NavLink>
    </nav>
  );
}
