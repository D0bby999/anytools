'use client';
import { useRouter } from '@/i18n/routing';
import { toolMetasClient } from '@anytools/tools/meta';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@anytools/ui';
import { Command } from 'cmdk';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const RECENT_KEY = 'anytools:recent';

export function CmdKPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('cmdk');

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'));
    } catch {
      // localStorage unavailable
    }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const select = (cluster: string, slug: string) => {
    const key = `${cluster}/${slug}`;
    setRecent((prev) => {
      const next = [key, ...prev.filter((r) => r !== key)].slice(0, 10);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setOpen(false);
    router.push(`/${cluster}/${slug}` as never);
  };

  const recentTools = recent
    .map((r) => {
      const [cluster, slug] = r.split('/');
      return toolMetasClient.find((m) => m.cluster === cluster && m.slug === slug);
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0">
        <DialogTitle className="sr-only">{t('placeholder')}</DialogTitle>
        <DialogDescription className="sr-only">Search across all tools</DialogDescription>
        <Command className="rounded-lg border-0">
          <Command.Input
            placeholder={t('placeholder')}
            autoFocus
            className="w-full px-4 py-3 bg-transparent outline-none border-b"
          />
          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              {t('empty')}
            </Command.Empty>
            {recentTools.length > 0 && (
              <Command.Group heading={t('recent')}>
                {recentTools.map((m) => (
                  <Command.Item
                    key={`recent-${m.slug}`}
                    onSelect={() => select(m.cluster, m.slug)}
                    className="px-3 py-2 rounded cursor-pointer hover:bg-accent"
                  >
                    {m.title[locale] ?? m.title.en}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {toolMetasClient.length > 0 && (
              <Command.Group heading={t('all')}>
                {/* published:false is a dark launch — out of the sitemap and the cluster pages,
                    and it must be out of the palette too or it is one keystroke from the front page. */}
                {toolMetasClient
                  .filter((m) => m.published !== false)
                  .map((m) => (
                    <Command.Item
                      key={`${m.cluster}/${m.slug}`}
                      value={`${m.title.en} ${m.keywords.join(' ')}`}
                      onSelect={() => select(m.cluster, m.slug)}
                      className="px-3 py-2 rounded cursor-pointer hover:bg-accent flex items-center justify-between"
                    >
                      <span>{m.title[locale] ?? m.title.en}</span>
                      <span className="text-xs opacity-50">{m.cluster}</span>
                    </Command.Item>
                  ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
