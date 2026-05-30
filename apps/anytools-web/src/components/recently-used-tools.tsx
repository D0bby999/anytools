'use client';
import { useToolHistory } from '@/hooks/use-tool-history';
import { Link } from '@/i18n/routing';
import { POPULAR_FALLBACK } from '@/lib/popular-fallback';
import type { ToolMetaClient } from '@anytools/tools/meta';
import { ArrowRight, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

type Props = {
  metas: ToolMetaClient[];
  locale: string;
};

/**
 * Hybrid "recently used / popular" strip on the homepage.
 *
 * Renders the user's localStorage tool history when present; falls back to a
 * curated POPULAR_FALLBACK list for first-time visitors. Hydration-safe: the
 * server renders the fallback (so first paint isn't empty), the client swaps
 * to history on hydration if any exists.
 */
export function RecentlyUsedTools({ metas, locale }: Props) {
  const t = useTranslations('landing');
  const { history, hydrated } = useToolHistory();

  const items = useMemo(() => {
    const slugs =
      hydrated && history.length > 0
        ? history.slice(0, 8).map((h) => h.slug)
        : POPULAR_FALLBACK.map((p) => p.slug);
    return slugs
      .map((slug) => metas.find((m) => m.slug === slug))
      .filter((m): m is ToolMetaClient => Boolean(m));
  }, [hydrated, history, metas]);

  const showingHistory = hydrated && history.length > 0;

  if (items.length === 0) return null;

  return (
    <section className="border-b py-10">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="flex items-center gap-2 mb-4">
          {showingHistory && <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {t('popularHeading')}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((m) => (
            <Link
              key={m.slug}
              href={`/${m.cluster}/${m.slug}` as never}
              className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent transition-colors duration-150"
            >
              {m.title[locale] ?? m.title.en}
              <ArrowRight className="h-3.5 w-3.5 opacity-60" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
