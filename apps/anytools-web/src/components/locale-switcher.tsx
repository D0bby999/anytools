'use client';
import { usePathname, useRouter } from '@/i18n/routing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@anytools/ui';
import { Languages } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useTransition } from 'react';

type LocaleOption = { code: 'en' | 'vi' | 'es' | 'pt'; label: string; flag: string };

const LOCALES: LocaleOption[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
];

export function LocaleSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const params = useParams();
  const [isPending, startTransition] = useTransition();

  const current = LOCALES.find((l) => l.code === locale) ?? (LOCALES[0] as LocaleOption);

  const change = (code: LocaleOption['code']) => {
    if (code === locale) return;
    startTransition(() => {
      // Preserve current pathname; next-intl handles locale prefix swap
      router.replace(
        // biome-ignore lint/suspicious/noExplicitAny: next-intl routing types are strict on dynamic params
        { pathname, params } as never,
        { locale: code },
      );
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Current language: ${current.label}. Click to change.`}
          disabled={isPending}
          className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent/10 hover:text-foreground transition-colors duration-150 ease-default disabled:opacity-50"
        >
          <Languages className="h-4 w-4" />
          <span className="hidden sm:inline">{current.code.toUpperCase()}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => change(l.code)}
            className={l.code === locale ? 'font-medium bg-accent/10' : ''}
          >
            <span className="mr-2">{l.flag}</span>
            <span>{l.label}</span>
            <span className="ml-auto text-xs text-muted-foreground">{l.code.toUpperCase()}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
