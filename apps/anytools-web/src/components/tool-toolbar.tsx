'use client';
import { useFavoriteTools } from '@/hooks/use-favorite-tools';
import { Badge, Button } from '@anytools/ui';
import { BookOpen, Check, Copy, HelpCircle, Link2, Share2, Star, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

type Props = {
  slug: string;
  cluster: string;
  hasTutorial: boolean;
  hasFaq: boolean;
};

export function ToolToolbar({ slug, cluster, hasTutorial, hasFaq }: Props) {
  const { isFavorite, toggle, hydrated } = useFavoriteTools();
  const t = useTranslations('toolbar');
  const [copied, setCopied] = useState(false);
  const favored = hydrated && isFavorite(slug);

  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: document.title });
        return;
      } catch {
        // user cancelled or unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked
    }
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-14 z-20 -mx-4 px-4 py-2 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="flex items-center justify-between gap-3">
        {/* Left: cluster badge + jump links */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <Badge variant="secondary" className="text-[11px] uppercase tracking-wide shrink-0">
            {cluster}
          </Badge>
          <button
            type="button"
            onClick={() => jumpTo('tool')}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            <Wrench className="h-3.5 w-3.5" />
            {t('tool')}
          </button>
          {hasTutorial && (
            <button
              type="button"
              onClick={() => jumpTo('tutorial')}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {t('tutorial')}
            </button>
          )}
          {hasFaq && (
            <button
              type="button"
              onClick={() => jumpTo('faq')}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors duration-150"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t('faq')}
            </button>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => toggle(slug)}
            aria-label={favored ? t('removeFavorite') : t('addFavorite')}
            title={favored ? t('removeFavorite') : t('addFavorite')}
            className="h-8 w-8"
          >
            <Star
              className={`h-4 w-4 transition-colors duration-150 ${
                favored ? 'fill-accent text-accent' : 'text-muted-foreground'
              }`}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={share}
            aria-label={t('share')}
            title={t('share')}
            className="h-8 w-8"
          >
            {copied ? (
              <Check className="h-4 w-4 text-accent" />
            ) : typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
              <Share2 className="h-4 w-4" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
          </Button>
          {copied && (
            <span className="text-xs text-accent hidden sm:inline" aria-live="polite">
              {t('linkCopied')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function inferShareIcon() {
  // Exported for tests; runtime uses inline check
  if (typeof navigator === 'undefined') return Link2;
  return typeof navigator.share === 'function' ? Share2 : Copy;
}
