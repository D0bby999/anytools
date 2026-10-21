import { Link, NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { sectionTabClass, SECTION_TABS_ROW } from "~/components/ui/section-tabs";
import { nativeName, type SavedLanguage } from "~/lib/languages";

/**
 * The languages the learner studies, one tab each, in their order, with the
 * words due today beside each as Mastery's tabs show them; then "+ Add a
 * language", which opens the picker. Each tab is its own URL.
 */
export function LanguageTabs({ studied, saved }: { studied: string[]; saved: SavedLanguage[] }) {
  const { t } = useTranslation("toolkit");
  const due = new Map(saved.map((s) => [s.lang, s.due]));
  return (
    <nav aria-label={t("languages.tabs.label")} className={SECTION_TABS_ROW}>
      {studied.map((l) => {
        const n = due.get(l) ?? 0;
        return (
          <NavLink key={l} to={`/languages/${l}`} className={sectionTabClass}>
            <span lang={l} dir="auto">
              {nativeName(l)}
            </span>
            {n > 0 ? (
              <span className="rounded-sm bg-highlight px-2 text-xs font-semibold text-highlight-foreground tabular-nums">
                <span aria-hidden="true">{n}</span>
                <span className="sr-only">{t("languages.tabs.due", { count: n })}</span>
              </span>
            ) : null}
          </NavLink>
        );
      })}
      <Link to="/languages?edit" className={sectionTabClass({ isActive: false })}>
        {t("languages.tabs.add")}
      </Link>
    </nav>
  );
}
