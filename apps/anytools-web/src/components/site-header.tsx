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
            className="group flex items-center gap-2 font-bold tracking-tight text-foreground hover:opacity-90 transition-opacity duration-150"
            aria-label="AnyTools home"
          >
            <svg
              viewBox="0 0 128 128"
              className="h-7 w-7 shrink-0 transition-transform duration-220 ease-spring group-hover:scale-110"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="atHeaderMark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#10B981" />
                  <stop offset="1" stopColor="#06B6D4" />
                </linearGradient>
              </defs>
              {/* Morphing-module mark: 3 cells mid-transform, staggered entrance */}
              <g className="logo-cell">
                <rect
                  x="22"
                  y="42"
                  width="46"
                  height="46"
                  rx="6"
                  fill="#10B981"
                  opacity="0.45"
                  transform="rotate(-8 45 65)"
                />
              </g>
              <g className="logo-cell logo-cell-2">
                <rect
                  x="36"
                  y="34"
                  width="46"
                  height="46"
                  rx="13"
                  fill="#10B981"
                  opacity="0.7"
                  transform="rotate(4 59 57)"
                />
              </g>
              <g className="logo-cell logo-cell-3">
                <rect x="52" y="24" width="46" height="46" rx="23" fill="url(#atHeaderMark)" />
              </g>
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
              className="hidden lg:inline-flex h-8 items-center gap-2 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground hover:bg-muted hover:border-accent/40 hover:text-accent transition-colors duration-150"
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
