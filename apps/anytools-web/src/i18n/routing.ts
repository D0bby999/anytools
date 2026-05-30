import { defaultLocale, locales } from '@anytools/i18n';
import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
