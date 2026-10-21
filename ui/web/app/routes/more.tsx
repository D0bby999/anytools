/**
 * more.tsx
 * Every destination in one list, as `up`'s group index pages are (pattern
 * P11): the page title, then each group of the table of contents as a heading
 * over its links. Rendered from NAV_TREE (lib/nav-tree.ts), so a page added to
 * the sidebar appears here without anyone remembering this page. The phone bar
 * that linked here is gone; the route stays so old links do not break.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/more";
import { PageHeader } from "~/components/ui/page-header";
import { appTitle } from "~/lib/app-title";
import { NAV_TREE, type NavPage } from "~/lib/nav-tree";
import { NOTE_JOIN } from "~/lib/sentence";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "All sections") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

const LINK = "font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function PageLink({ page }: { page: NavPage }) {
  const { t } = useTranslation("common");
  // The tools site is outside this app's router: a document link.
  return page.external ? (
    <a href={page.to} className={LINK}>
      {t(page.labelKey)}
    </a>
  ) : (
    <Link to={page.to} className={LINK}>
      {t(page.labelKey)}
    </Link>
  );
}

function descriptionKey(page: NavPage) {
  return `home.up.descriptions.${page.labelKey.split(".").pop()}`;
}

function PageList({ pages, nested = false }: { pages: NavPage[]; nested?: boolean }) {
  const { t } = useTranslation("common");

  return (
    <ul className={nested ? "mt-2 space-y-2 pl-4" : "mt-4 space-y-2 leading-prose"}>
      {pages.map((page) => (
        <li key={page.to}>
          <PageLink page={page} />{NOTE_JOIN}<span className="text-muted-foreground">{t(descriptionKey(page))}</span>
          {page.items ? <PageList pages={page.items} nested /> : null}
        </li>
      ))}
    </ul>
  );
}

export default function More() {
  const { t } = useTranslation("common");
  return (
    <div>
      <PageHeader title={t("more.title")} lede={t("more.lead")} />
      {NAV_TREE.map((group) => (
        <section key={group.id} aria-labelledby={`lp-more-${group.id}`}>
          <h2 id={`lp-more-${group.id}`} className="mt-12 border-t pt-6 text-2xl font-semibold">
            {t(group.labelKey)}
          </h2>
          <PageList pages={group.items} />
        </section>
      ))}
    </div>
  );
}
