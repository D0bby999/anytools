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
import { appTitle } from "~/lib/app-title";
import { NAV_ITEMS, TOOLS_ITEM } from "~/components/layout/sidebar";
import { PARTS } from "~/lib/parts";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "All sections") },
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

const ROW =
  "flex min-h-12 items-center gap-3 px-1 py-3 text-base transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

/**
 * The phone's table of contents: the same order as the rail (Today, the four
 * parts under their tabs, Settings), then the study tools that have no rail
 * row, then the tools appendix.
 */
export default function More() {
  const { t } = useTranslation("common");
  const item = (n: (typeof NAV_ITEMS)[number]) => (
    <li key={n.to} className="border-b">
      <Link to={n.to} className={ROW}>
        <n.icon aria-hidden="true" className="size-5 text-part" />
        {t(n.labelKey)}
      </Link>
    </li>
  );
  return (
    <div className="lp-measure">
      <PageHeader title={t("more.title")} lede={t("more.lead")} />
      <ul className="border-t" data-part="home">
        {NAV_ITEMS.filter((n) => n.to === "/home").map(item)}
      </ul>
      {PARTS.map((part) => (
        <section key={part.id} data-part={part.id} aria-labelledby={`lp-more-${part.id}`} className="mt-8">
          <h2 id={`lp-more-${part.id}`} className="flex items-center gap-2 font-serif text-lg font-semibold text-part">
            <span aria-hidden="true" className="lp-tab min-w-7 justify-center">
              {part.numeral}
            </span>
            <span className="sr-only">{t("parts.part", { numeral: part.numeral })}: </span>
            {t(part.labelKey)}
          </h2>
          <ul className="mt-2 border-t">{NAV_ITEMS.filter((n) => n.part === part.id).map(item)}</ul>
        </section>
      ))}
      <ul className="mt-8 border-t" data-part="home">
        {NAV_ITEMS.filter((n) => n.to === "/settings").map(item)}
      </ul>

      <h2 className="lp-section mt-10">{t("more.toolsTitle")}</h2>
      <ul className="mt-3 border-t">
        {TOOL_ITEMS.map(({ to, labelKey }) => (
          <li key={to} className="border-b">
            <Link to={to} className={ROW}>
              {t(labelKey)}
            </Link>
          </li>
        ))}
      </ul>

      <section data-part="tools" aria-labelledby="lp-more-appendix" className="mt-10">
        <h2 id="lp-more-appendix" className="lp-section text-part">
          {t("appendix.title")}
        </h2>
        <a href={TOOLS_ITEM.to} className={`${ROW} mt-3 border-y`}>
          <TOOLS_ITEM.icon aria-hidden="true" className="size-5 text-part" />
          {t("appendix.all")}
        </a>
      </section>
    </div>
  );
}
