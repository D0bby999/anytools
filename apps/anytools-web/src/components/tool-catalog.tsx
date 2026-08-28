'use client';
import { Link } from '@/i18n/routing';
import type { ToolMetaClient } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';
import { Badge, Card, CardDescription, CardHeader, CardTitle, Input } from '@anytools/ui';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useMemo, useState, useTransition } from 'react';

const SORT_OPTIONS = ['popular', 'az', 'recent'] as const;
type Sort = (typeof SORT_OPTIONS)[number];

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

// Typed exhaustively against ClusterId — adding a new cluster without an entry is a compile error.
const CLUSTER_COLOR: Record<ClusterId, string> = {
  encoding: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  formatters: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
  generators: 'bg-green-500/10 text-green-700 dark:text-green-300',
  converters: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  'text-regex': 'bg-pink-500/10 text-pink-700 dark:text-pink-300',
  'time-date': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  web3: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  marketing: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  'ecommerce-vn': 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  // General-public clusters (Phase 3+) — match accent tokens in globals.css
  finance: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  health: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  lifestyle: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  design: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

type Props = {
  metas: ToolMetaClient[];
  locale: string;
};

export function ToolCatalog({ metas, locale }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('catalog');
  const [, startTransition] = useTransition();

  // URL state (shareable filtered views)
  const initialCluster = searchParams.get('cluster') ?? 'all';
  const initialSort = (searchParams.get('sort') as Sort) ?? 'popular';
  const initialQuery = searchParams.get('q') ?? '';

  const [cluster, setCluster] = useState(initialCluster);
  const [sort, setSort] = useState<Sort>(initialSort);
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);

  // Cluster counts (only show clusters that have tools available in current locale)
  const clusters = useMemo(() => {
    const counts = {} as Partial<Record<ClusterId, number>>;
    for (const m of metas) {
      if (m.availableLocales && !m.availableLocales.includes(locale as never)) continue;
      counts[m.cluster] = (counts[m.cluster] ?? 0) + 1;
    }
    return (Object.entries(counts) as Array<[ClusterId, number]>).sort((a, b) => b[1] - a[1]);
  }, [metas, locale]);

  // Filter + sort pipeline
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    // Hide tools whose availableLocales excludes the current locale — they 404 on click.
    let result = metas.filter(
      (m) => !m.availableLocales || m.availableLocales.includes(locale as never),
    );
    if (cluster !== 'all') result = result.filter((m) => m.cluster === cluster);
    if (q) {
      result = result.filter((m) => {
        const haystack = [
          m.slug,
          m.title[locale] ?? m.title.en ?? '',
          m.description[locale] ?? m.description.en ?? '',
          ...m.keywords,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    switch (sort) {
      case 'az':
        result = [...result].sort((a, b) => {
          const aTitle = a.title[locale] ?? a.title.en ?? a.slug;
          const bTitle = b.title[locale] ?? b.title.en ?? b.slug;
          return aTitle.localeCompare(bTitle, locale);
        });
        break;
      case 'recent':
        // Newest = end of array (registry order is chronological)
        result = [...result].reverse();
        break;
      default: // popular
        result = [...result].sort(
          (a, b) => (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99),
        );
    }
    return result;
  }, [metas, cluster, sort, deferredQuery, locale]);

  // Sync URL when filters change (debounced via transition)
  const syncUrl = (next: { cluster?: string; sort?: Sort; q?: string }) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      const c = next.cluster ?? cluster;
      const s = next.sort ?? sort;
      const q = next.q ?? query;
      if (c === 'all') params.delete('cluster');
      else params.set('cluster', c);
      if (s === 'popular') params.delete('sort');
      else params.set('sort', s);
      if (!q.trim()) params.delete('q');
      else params.set('q', q.trim());
      const str = params.toString();
      router.replace(str ? `?${str}` : '?', { scroll: false });
    });
  };

  return (
    <div className="space-y-6">
      {/* Search + Sort row */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              syncUrl({ q: e.target.value });
            }}
            placeholder={t('searchPlaceholder', { count: metas.length })}
            className="pl-10 pr-10 h-11"
            aria-label={t('searchPlaceholder', { count: metas.length })}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                syncUrl({ q: '' });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          value={sort}
          onChange={(e) => {
            const next = e.target.value as Sort;
            setSort(next);
            syncUrl({ sort: next });
          }}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent/5 transition-colors"
          aria-label={t('sortLabel')}
        >
          <option value="popular">{t('sortPopular')}</option>
          <option value="az">{t('sortAz')}</option>
          <option value="recent">{t('sortRecent')}</option>
        </select>
      </div>

      {/* Cluster filter chips */}
      <div className="flex flex-wrap gap-2">
        <ChipButton
          active={cluster === 'all'}
          onClick={() => {
            setCluster('all');
            syncUrl({ cluster: 'all' });
          }}
        >
          {t('clusterAll')} <span className="opacity-80">{metas.length}</span>
        </ChipButton>
        {clusters.map(([c, count]) => (
          <ChipButton
            key={c}
            active={cluster === c}
            onClick={() => {
              setCluster(c);
              syncUrl({ cluster: c });
            }}
          >
            {t(`cluster.${c}`, { default: c })} <span className="opacity-80">{count}</span>
          </ChipButton>
        ))}
      </div>

      {/* Results */}
      {visible.length === 0 ? (
        <Card className="text-center py-12">
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyBody')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        // Four columns on wide screens: 68 tools scan far better as a dense grid
        // than as three roomy ones, and density is the point on a utility site.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visible.map((m) => (
            <Link key={m.slug} href={`/${m.cluster}/${m.slug}` as never} className="block group">
              <Card className="h-full transition-all duration-150 hover:border-accent hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <CardTitle className="text-base group-hover:text-accent transition-colors duration-150">
                      {m.title[locale] ?? m.title.en}
                    </CardTitle>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] uppercase tracking-wide shrink-0 border-0 ${CLUSTER_COLOR[m.cluster] ?? ''}`}
                    >
                      {m.cluster}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {m.description[locale] ?? m.description.en}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-2">
        {t('showing', { visible: visible.length, total: metas.length })}
      </p>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors duration-150 ${
        active
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-card hover:bg-accent/5 text-foreground border-border'
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
