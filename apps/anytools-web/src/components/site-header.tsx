'use client';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/routing';
import { Command, Github } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export function SiteHeader() {
  const t = useTranslations();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 w-full transition-all duration-220 ease-default ${
        scrolled
          ? 'border-b bg-background/80 backdrop-blur-md shadow-sm'
          : 'bg-background/60 backdrop-blur'
      }`}
    >
      <div className="container mx-auto max-w-6xl px-4">
        <div className="flex h-14 items-center justify-between gap-3">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2 font-bold tracking-tight text-foreground hover:opacity-80 transition-opacity duration-150"
            aria-label="AnyTools home"
          >
            <svg viewBox="0 0 128 128" className="h-7 w-7 shrink-0" aria-hidden="true">
              <rect width="128" height="128" rx="28" fill="#2563EB" />
              <path
                d="M40 96 L60 32 L68 32 L88 96 L77 96 L72 80 L56 80 L51 96 Z M59 71 L69 71 L64 54 Z"
                fill="#FFFFFF"
              />
            </svg>
            <span className="text-base">AnyTools</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors duration-150"
            >
              {t('nav.tools')}
            </Link>
            <Link
              href="/guides"
              className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors duration-150"
            >
              {t('nav.blog')}
            </Link>
            <Link
              href={'/favorites' as never}
              className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors duration-150"
            >
              {t('nav.favorites')}
            </Link>
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            {/* Cmd+K hint — desktop only */}
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
              }}
              className="hidden lg:inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground hover:bg-muted transition-colors duration-150"
              aria-label="Open command palette"
            >
              <Command className="h-3.5 w-3.5" />
              <span>K</span>
            </button>

            <LocaleSwitcher />
            <ThemeToggle />

            <a
              href="https://github.com/D0bby999/anytools"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors duration-150"
              aria-label="GitHub"
              title="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
