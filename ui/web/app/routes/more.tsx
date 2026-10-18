/**
 * more.tsx
 * Every destination in one list — the phone bar's "More" slot (sidebar.tsx).
 * Rendered from NAV_ITEMS, so a destination added to the rail appears here
 * without anyone remembering this page. Below them, the study tools that live
 * inside a section rather than on the rail (learning depth): on a phone this
 * is the one place that lists them all.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/more";
import { NAV_ITEMS } from "~/components/layout/sidebar";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "All sections · AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** Study tools reached from inside a section, not from the rail. */
export const TOOL_ITEMS = [
  { to: "/quiz/practice", labelKey: "more.tools.practice" },
  { to: "/quiz/exams", labelKey: "more.tools.exams" },
  { to: "/mastery/vocabulary", labelKey: "more.tools.vocabulary" },
  { to: "/mastery/book-cards", labelKey: "more.tools.bookCards" },
  { to: "/settings/profile", labelKey: "more.tools.profile" },
  { to: "/toolkit", labelKey: "toolkit:moreItem" },
] as const;

export default function More() {
  const { t } = useTranslation("common");
  return (
    <div className="lp-measure">
      <div className="lp-prose">
        <h1>{t("more.title")}</h1>
        <p>{t("more.lead")}</p>
      </div>
      <ul className="mt-6 border-t">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <li key={to} className="border-b">
            <Link
              to={to}
              className="flex min-h-12 items-center gap-3 px-1 py-3 text-base transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
              {t(labelKey)}
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="lp-kicker mt-10">{t("more.toolsTitle")}</h2>
      <ul className="mt-3 border-t">
        {TOOL_ITEMS.map(({ to, labelKey }) => (
          <li key={to} className="border-b">
            <Link
              to={to}
              className="flex min-h-12 items-center px-1 py-3 text-base transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              {t(labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
