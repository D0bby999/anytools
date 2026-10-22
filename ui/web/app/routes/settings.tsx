/**
 * settings.tsx
 * The Settings shell: one heading, its sections in a grouped rail beside
 * them, one place the product's readiness is explained.
 *
 * It is a layout rather than one page because the three surfaces answer
 * different questions — what have I connected, what serves what, and what can
 * search the web — and a single scrolling page would bury the third behind the
 * first two.
 */
import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/components/ui/page-header";
import { SettingsPicker, SettingsRail } from "~/components/settings/settings-nav";
import type { Route } from "./+types/settings";
import { appTitle } from "~/lib/app-title";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Settings") }, { name: "robots", content: "noindex, nofollow" }];
}

/**
 * The whole width (app-layout's `layout: "page"`): Settings brings its own
 * navigation, a rail beside the section as postclaw's settings do (owner,
 * 2026-10-21), so the page outline's column would be a third one.
 */
export const handle = { layout: "page" };

export default function Settings() {
  const { t } = useTranslation("common");

  return (
    <div className="flex min-w-0 flex-1 gap-10">
      <SettingsRail />
      <div className="lp-doc min-w-0 max-w-(--lp-measure-read) flex-1">
        <PageHeader title={t("settings.title")} lede={t("settings.lead")} className="mb-6" />
        <SettingsPicker />
        <Outlet />
      </div>
    </div>
  );
}
