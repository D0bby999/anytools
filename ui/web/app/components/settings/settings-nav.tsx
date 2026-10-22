/**
 * settings-nav.tsx
 * Settings' own navigation, after postclaw's settings rail (owner,
 * 2026-10-21): a column of grouped, icon-led rows beside the section's
 * content from 768, and on a phone one button naming where you are that
 * opens the same groups in a dialog.
 *
 * The rows are drawn like the app sidebar's (32 high, a 16px icon, a rounded
 * hover, the current one filled in the selected tint on all four sides), so
 * the two columns read as one system. Group titles are 12/600 in sentence
 * case: AnyLearn's labels are never capitals.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, matchPath, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Bell, Blocks, ChevronDown, IdCard, KeyRound, Plug, Route as RouteIcon, UserRound, type LucideIcon } from "lucide-react";
import { Dialog } from "~/components/doc/dialog";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export type SettingsSection = { to: string; labelKey: string; icon: LucideIcon; end?: boolean };
export type SettingsGroup = { id: string; labelKey: string; sections: SettingsSection[] };

/** The order matches NAV_TREE's Settings group (pager, search, /more). */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "ai",
    labelKey: "settings.nav.groups.ai",
    sections: [
      { to: "/settings", labelKey: "settings.nav.connections", icon: Plug, end: true },
      { to: "/settings/providers", labelKey: "settings.nav.providers", icon: Blocks },
      { to: "/settings/routes", labelKey: "settings.nav.routes", icon: RouteIcon },
      { to: "/settings/search", labelKey: "settings.nav.search", icon: KeyRound },
    ],
  },
  {
    id: "you",
    labelKey: "settings.nav.groups.you",
    sections: [
      { to: "/settings/account", labelKey: "settings.nav.account", icon: UserRound },
      { to: "/settings/profile", labelKey: "settings.nav.profile", icon: IdCard },
    ],
  },
  {
    id: "notify",
    labelKey: "settings.nav.groups.notify",
    sections: [{ to: "/settings/reminders", labelKey: "settings.nav.reminders", icon: Bell }],
  },
];

/** The section a path is in: `/settings` exactly, any other one with its children. */
export function activeSection(pathname: string): { group: SettingsGroup; section: SettingsSection } | undefined {
  for (const group of SETTINGS_GROUPS) {
    for (const section of group.sections) {
      if (matchPath({ path: section.to, end: !!section.end }, pathname)) return { group, section };
    }
  }
  return undefined;
}

const ROW =
  "-mx-2 flex items-center gap-3 rounded-md px-2 py-1 text-sm leading-6 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** `onPick` is the dialog's: its rows are 44 high, a thumb's target. */
function Rows({ onPick }: { onPick?: () => void }) {
  const { t } = useTranslation("common");
  return (
    <>
      {SETTINGS_GROUPS.map((group, i) => (
        <div key={group.id} role="group" aria-label={t(group.labelKey)} className={i === 0 ? undefined : "mt-4"}>
          <p aria-hidden="true" className="mb-1 text-xs leading-5 font-semibold text-muted-foreground">
            {t(group.labelKey)}
          </p>
          <ul>
            {group.sections.map(({ to, labelKey, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={onPick}
                  className={({ isActive }) =>
                    cn(ROW, onPick ? "min-h-11" : "min-h-8", isActive ? "bg-selected font-semibold text-selected-foreground" : "text-foreground hover:bg-hover")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon aria-hidden="true" className={cn("size-4 shrink-0", isActive ? "text-selected-foreground" : "text-deco")} />
                      <span className="min-w-0 truncate">{t(labelKey)}</span>
                      {isActive ? <span className="sr-only"> {t("nav.current")}</span> : null}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The rail, from 768: sticks below the nav while a long section scrolls. */
export function SettingsRail() {
  const { t } = useTranslation("common");
  return (
    <nav
      aria-label={t("settings.nav.label")}
      className="sticky top-8 hidden w-52 shrink-0 self-start md:block"
    >
      <Rows />
    </nav>
  );
}

/** Below 768: where you are, as one button; the groups open in a dialog. */
export function SettingsPicker() {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLElement>(null);
  // The dialog focuses its first link; where you are is the better start.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, [open]);
  const active = activeSection(pathname) ?? { group: SETTINGS_GROUPS[0]!, section: SETTINGS_GROUPS[0]!.sections[0]! };
  const Icon = active.section.icon;
  return (
    <div className="mb-6 md:hidden">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-control-border bg-card px-4 text-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span className="truncate text-left">
            <span className="text-muted-foreground">{t(active.group.labelKey)} · </span>
            <span className="font-semibold">{t(active.section.labelKey)}</span>
          </span>
        </span>
        <span className="sr-only">{t("settings.nav.pick")}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-deco" />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("settings.title")}
        actions={
          // Below 768 the dialog is the whole screen, with no page to tap.
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("settings.up.close")}
          </Button>
        }
      >
        <nav ref={list} aria-label={t("settings.nav.label")} className="px-2">
          <Rows onPick={() => setOpen(false)} />
        </nav>
      </Dialog>
    </div>
  );
}
