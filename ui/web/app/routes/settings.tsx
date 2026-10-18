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
import { NavLink, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Settings · AnyTools" }, { name: "robots", content: "noindex, nofollow" }];
}

const SECTIONS = [
  { to: "/settings", labelKey: "settings.nav.connections", end: true },
  { to: "/settings/routes", labelKey: "settings.nav.routes", end: false },
  { to: "/settings/search", labelKey: "settings.nav.search", end: false },
  { to: "/settings/profile", labelKey: "settings.nav.profile", end: false },
  // drive-user-storage phase 2; its label lives in its own namespace.
  { to: "/settings/storage", labelKey: "storage:nav", end: false },
  { to: "/settings/account", labelKey: "settings.nav.account", end: false },
] as const;

export default function Settings() {
  const { t } = useTranslation("common");

  return (
    <div className="lp-layout">
      <h1 className="font-serif text-2xl">{t("settings.title")}</h1>
      <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("settings.lead")}
      </p>

      <nav aria-label={t("settings.nav.label")} className="mt-6 border-b">
        <ul className="flex flex-wrap gap-1">
          {SECTIONS.map(({ to, labelKey, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center rounded-t-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-selected font-medium text-selected-foreground"
                      : "text-muted-foreground hover:bg-primary-soft hover:text-foreground",
                  )
                }
              >
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

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
