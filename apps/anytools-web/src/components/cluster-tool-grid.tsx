import { Link } from '@/i18n/routing';
import type { ToolMeta } from '@anytools/tools/types';
import { ArrowRight } from 'lucide-react';

type Props = {
  tools: ToolMeta[];
  locale: string;
  emptyTitle: string;
  emptyBody: string;
};

/**
 * Server-rendered tool grid for a cluster landing page. No client JS.
 * Shows a "Coming soon" empty state when the cluster has no published tools yet.
 */
export function ClusterToolGrid({ tools, locale, emptyTitle, emptyBody }: Props) {
  if (tools.length === 0) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <div className="rounded-lg border border-dashed bg-card p-12 text-center max-w-md mx-auto">
          <p className="text-base font-medium mb-2">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{emptyBody}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tools.map((m) => {
          const title = m.title[locale] ?? m.title.en ?? m.slug;
          const description = m.description[locale] ?? m.description.en ?? '';
          return (
            <li key={m.slug}>
              <Link
                href={`/${m.cluster}/${m.slug}` as never}
                className="block h-full rounded-lg border bg-card p-4 hover:border-accent hover:bg-accent/5 transition-colors duration-150 group"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="font-semibold text-foreground group-hover:text-accent transition-colors">
                    {title}
                  </h3>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
