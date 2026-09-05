'use client';
import { type ReactNode, createContext, useContext, useMemo } from 'react';

/**
 * Locale plumbing for tool widgets.
 *
 * Tool UIs live in `@anytools/tools`, a plain React package with no next-intl and no
 * access to the route. The page knows the locale; the widget does not. This context is
 * the one hand-off: the page wraps the widget in <ToolLocaleProvider locale=...> and every
 * component underneath (the tool itself, CopyButton, PrivacyNote…) reads it with a hook.
 *
 * Strings stay colocated with each tool (`<tool>/strings.ts`), mirroring how `meta.ts`
 * already keeps its title/description per locale. A missing locale — or a missing key
 * inside a locale — falls back to English key-by-key, so a half-translated tool still
 * renders every label instead of `undefined`.
 */
export type UiLocale = 'en' | 'vi' | 'es' | 'pt';

const UI_LOCALES: readonly string[] = ['en', 'vi', 'es', 'pt'];

/** Narrow an arbitrary route segment to a locale we have strings for. */
export function toUiLocale(locale: string | undefined): UiLocale {
  return locale && UI_LOCALES.includes(locale) ? (locale as UiLocale) : 'en';
}

/**
 * English is the complete source of truth; every other locale is a partial overlay.
 * `{ en: { output: 'Output' }, vi: { output: 'Kết quả' } }`
 */
export type LocalizedStrings<T extends Record<string, string>> = { en: T } & Partial<
  Record<Exclude<UiLocale, 'en'>, Partial<T>>
>;

const ToolLocaleContext = createContext<UiLocale>('en');

export function ToolLocaleProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  return (
    <ToolLocaleContext.Provider value={toUiLocale(locale)}>{children}</ToolLocaleContext.Provider>
  );
}

export function useToolLocale(): UiLocale {
  return useContext(ToolLocaleContext);
}

/** Pure resolver — exported so logic/tests can localize without a React tree. */
export function pickStrings<T extends Record<string, string>>(
  table: LocalizedStrings<T>,
  locale: UiLocale,
): T {
  if (locale === 'en') return table.en;
  const overlay = table[locale];
  return overlay ? ({ ...table.en, ...overlay } as T) : table.en;
}

/** Resolve a per-tool string table against the current locale. */
export function useLocalized<T extends Record<string, string>>(table: LocalizedStrings<T>): T {
  const locale = useToolLocale();
  return useMemo(() => pickStrings(table, locale), [table, locale]);
}
