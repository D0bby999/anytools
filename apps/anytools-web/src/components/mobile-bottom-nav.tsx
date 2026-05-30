'use client';
import { Link, usePathname } from '@/i18n/routing';
import { BookOpen, Home, Star, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

type NavItem = {
  href: string;
  labelKey: string;
  Icon: ComponentType<{ className?: string }>;
  matchPrefix: string;
};

const ITEMS: NavItem[] = [
  { href: '/', labelKey: 'nav.home', Icon: Home, matchPrefix: '/$' },
  {
    href: '/',
    labelKey: 'nav.tools',
    Icon: Wrench,
    matchPrefix:
      '/(encoding|formatters|generators|converters|text-regex|time-date|web3|finance|health|lifestyle|design)',
  },
  { href: '/guides', labelKey: 'nav.blog', Icon: BookOpen, matchPrefix: '/guides' },
  { href: '/favorites', labelKey: 'nav.favorites', Icon: Star, matchPrefix: '/favorites' },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const t = useTranslations();

  const isActive = (item: NavItem) => {
    if (item.matchPrefix === '/$') return pathname === '/';
    return new RegExp(item.matchPrefix).test(pathname);
  };

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.labelKey}>
              <Link
                href={item.href as never}
                className="flex flex-col items-center gap-1 py-2 min-h-[44px] touch-manipulation transition-colors duration-150"
                aria-current={active ? 'page' : undefined}
              >
                <item.Icon
                  className={`h-5 w-5 transition-colors duration-150 ${
                    active ? 'text-accent' : 'text-muted-foreground'
                  }`}
                />
                <span
                  className={`text-[11px] font-medium transition-colors duration-150 ${
                    active ? 'text-accent' : 'text-muted-foreground'
                  }`}
                >
                  {t(item.labelKey)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
