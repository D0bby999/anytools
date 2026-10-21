import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { sectionTabClass, SECTION_TABS_ROW } from "~/components/ui/section-tabs";

/**
 * Quiz's sections, the way Mastery shows its own (mastery-tabs.tsx). They were
 * a line of small links under each header, different on every page, and the
 * page you were on was the one link missing from it.
 */
export function QuizTabs() {
  const { t } = useTranslation("study");
  return (
    <nav aria-label={t("quizTabs.label")} className={SECTION_TABS_ROW}>
      <NavLink to="/quiz" end className={sectionTabClass}>
        {t("practise.today")}
      </NavLink>
      <NavLink to="/quiz/bank" className={sectionTabClass}>
        {t("quizTabs.bank")}
      </NavLink>
      <NavLink to="/quiz/practice" className={sectionTabClass}>
        {t("practise.practice")}
      </NavLink>
      <NavLink to="/quiz/exams" className={sectionTabClass}>
        {t("quizTabs.exams")}
      </NavLink>
    </nav>
  );
}
