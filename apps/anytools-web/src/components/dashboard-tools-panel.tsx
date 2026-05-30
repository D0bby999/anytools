'use client';
import { useFavoriteTools } from '@/hooks/use-favorite-tools';
import { useToolHistory } from '@/hooks/use-tool-history';
import { Link } from '@/i18n/routing';
import type { ToolMetaClient } from '@anytools/tools/meta';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@anytools/ui';
import { ArrowRight, Clock, Star, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

type Props = {
  metas: ToolMetaClient[];
  locale: string;
};

const RELATIVE_TIME = (locale: string, ms: number) => {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
};

export function DashboardToolsPanel({ metas, locale }: Props) {
  const t = useTranslations('dashboardPanel');
  const { favorites, hydrated: favHydrated } = useFavoriteTools();
  const { history, clear: clearHistory, hydrated: historyHydrated } = useToolHistory();

  const favoriteMetas = useMemo(
    () =>
      favorites
        .map((slug) => metas.find((m) => m.slug === slug))
        .filter((m): m is ToolMetaClient => Boolean(m)),
    [favorites, metas],
  );

  const recentEntries = useMemo(() => {
    return history
      .map((entry) => ({ entry, meta: metas.find((m) => m.slug === entry.slug) }))
      .filter((x): x is { entry: typeof x.entry; meta: ToolMetaClient } => Boolean(x.meta));
  }, [history, metas]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Favorites */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Star className="h-4 w-4 text-accent" />
            {t('favoritesTitle')}
            <Badge variant="secondary" className="ml-auto text-xs">
              {favoriteMetas.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!favHydrated ? (
            <SkeletonRows />
          ) : favoriteMetas.length === 0 ? (
            <EmptyState
              icon={<Star className="h-5 w-5" />}
              title={t('favoritesEmptyTitle')}
              body={t('favoritesEmptyBody')}
              ctaLabel={t('browseTools')}
              ctaHref="/"
            />
          ) : (
            <ul className="space-y-1">
              {favoriteMetas.map((m) => (
                <ToolRow key={m.slug} meta={m} locale={locale} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-4 w-4 text-accent" />
            {t('recentTitle')}
            {recentEntries.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="ml-auto text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                {t('clearHistory')}
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!historyHydrated ? (
            <SkeletonRows />
          ) : recentEntries.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-5 w-5" />}
              title={t('recentEmptyTitle')}
              body={t('recentEmptyBody')}
              ctaLabel={t('browseTools')}
              ctaHref="/"
            />
          ) : (
            <ul className="space-y-1">
              {recentEntries.slice(0, 10).map(({ meta, entry }) => (
                <ToolRow
                  key={meta.slug}
                  meta={meta}
                  locale={locale}
                  meta2={RELATIVE_TIME(locale, entry.visitedAt)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ToolRow({
  meta,
  locale,
  meta2,
}: { meta: ToolMetaClient; locale: string; meta2?: string }) {
  return (
    <li>
      <Link
        href={`/${meta.cluster}/${meta.slug}` as never}
        className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-accent/5 transition-colors duration-150 group"
      >
        <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate group-hover:text-accent transition-colors">
            {meta.title[locale] ?? meta.title.en}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {meta.cluster}
            {meta2 && <> · {meta2}</>}
          </div>
        </div>
        <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      </Link>
    </li>
  );
}

function EmptyState({
  icon,
  title,
  body,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="text-center py-6">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
        {icon}
      </div>
      <CardTitle className="text-sm font-medium mb-1">{title}</CardTitle>
      <CardDescription className="text-xs mb-4">{body}</CardDescription>
      <Button asChild size="sm" variant="outline">
        <Link href={ctaHref as never}>{ctaLabel}</Link>
      </Button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="h-4 w-4 rounded bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-muted/60 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}
