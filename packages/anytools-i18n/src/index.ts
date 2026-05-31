export const locales = ['en', 'vi', 'es', 'pt'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
  es: 'Español',
  pt: 'Português',
};

export function isValidLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
