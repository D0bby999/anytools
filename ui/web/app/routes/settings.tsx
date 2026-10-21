/**
 * settings.tsx
 * The Settings shell: one heading, three sections, one place the product's
 * readiness is explained.
 *
 * It is a layout rather than one page because the three surfaces answer
 * different questions — what have I connected, what serves what, and what can
 * search the web — and a single scrolling page would bury the third behind the
 * first two.
 */
import { NAV_TREE } from "~/lib/nav-tree";
import { NavLink, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/ui/page-header";
import { sectionTabClass, SECTION_TABS_ROW } from "~/components/ui/section-tabs";
import type { Route } from "./+types/settings";
import { appTitle } from "~/lib/app-title";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Settings") }, { name: "robots", content: "noindex, nofollow" }];
}

const SECTIONS = [
  { to: "/settings", labelKey: "settings.nav.connections", end: true },
  { to: "/settings/providers", labelKey: "settings.nav.providers", end: false },
  { to: "/settings/routes", labelKey: "settings.nav.routes", end: false },
  { to: "/settings/search", labelKey: "settings.nav.search", end: false },
  { to: "/settings/profile", labelKey: "settings.nav.profile", end: false },
  // The daily review reminder, and installing AnyLearn on this device.
  { to: "/settings/reminders", labelKey: "settings.nav.reminders", end: false },
  { to: "/settings/account", labelKey: "settings.nav.account", end: false },
] as const;
const SETTINGS_ORDER = NAV_TREE.find((group) => group.id === "settings")!.items.map((page) => page.to);
const ORDERED_SECTIONS = [...SECTIONS].sort((a, b) => SETTINGS_ORDER.indexOf(a.to) - SETTINGS_ORDER.indexOf(b.to));

export default function Settings() {
  const { t } = useTranslation("common");

  return (
    <div className="lp-doc">
      <PageHeader title={t("settings.title")} lede={t("settings.lead")} className="mb-6" />

      <nav aria-label={t("settings.nav.label")}>
        <ul className={SECTION_TABS_ROW}>
          {ORDERED_SECTIONS.map(({ to, labelKey, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={sectionTabClass}>
                {({ isActive }) => (
                  <>
                    {t(labelKey)}
                    {/* Colour and weight already carry this; the text is what
                        survives a colour-blind read and forced high contrast. */}
                    {isActive && <span className="sr-only">{t("nav.current")}</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <Outlet />
      </div>
    </div>
  );
}
