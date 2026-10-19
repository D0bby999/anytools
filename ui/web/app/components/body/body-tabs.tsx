import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { sectionTabClass, SECTION_TABS_ROW } from "~/components/ui/section-tabs";

/**
 * Body's sections. One rail row (DESIGN.md caps the navigation); the rest
 * are tabs under it, as Mastery does.
 */
export function BodyTabs() {
  const { t } = useTranslation("body");
  return (
    <nav aria-label={t("tabs.label")} className={SECTION_TABS_ROW}>
      <NavLink to="/body" end className={sectionTabClass}>
        {t("tabs.today")}
      </NavLink>
      <NavLink to="/body/plan" className={sectionTabClass}>
        {t("tabs.plan")}
      </NavLink>
      <NavLink to="/body/progress" className={sectionTabClass}>
        {t("tabs.progress")}
      </NavLink>
      <NavLink to="/body/coach" className={sectionTabClass}>
        {t("tabs.coach")}
      </NavLink>
      <NavLink to="/body/library" className={sectionTabClass}>
        {t("tabs.library")}
      </NavLink>
    </nav>
  );
}
