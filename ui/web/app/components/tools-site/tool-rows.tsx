import { Link } from "react-router";
import { useTranslation } from "react-i18next";

export type ToolRow = { slug: string; cluster: string; title: string; description: string; ported: boolean };

/**
 * Tools as hairline rows, several columns wide on a large screen: a catalog
 * of a hundred tools is a list to scan, not a wall of cards (DESIGN.md).
 * `showCluster` names each row's cluster for a list that mixes them.
 */
export function ToolRows({ locale, tools, showCluster = false }: { locale: string; tools: ToolRow[]; showCluster?: boolean }) {
  const { t } = useTranslation("tools");
  return (
    <ul className="grid grid-cols-1 gap-x-8 border-t md:grid-cols-2 xl:grid-cols-3">
      {tools.map((tool) => (
        <li key={tool.slug} className="border-b">
          <Link
            to={`/${locale}/${tool.cluster}/${tool.slug}`}
            className="group flex h-full flex-col gap-1 px-1 py-3.5 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-serif text-lg leading-snug font-semibold group-hover:text-primary">{tool.title}</span>
              {showCluster && (
                <span className="shrink-0 text-xs text-faint">
                  {t(`catalog.cluster.${tool.cluster}`)}
                </span>
              )}
            </span>
            <span className="line-clamp-2 text-sm text-muted-foreground">{tool.description}</span>
            {!tool.ported && <span className="text-xs text-faint">{t("tool.comingBackTitle")}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
