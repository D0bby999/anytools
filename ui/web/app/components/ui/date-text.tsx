/**
 * A date as a reader says it: "19 Oct 2026", or "19 Oct 2026, 20:03" with the
 * time. `toLocaleDateString()` with no locale printed "10/19/2026" for some and
 * "19/10/2026" for others, the one form nobody can read without knowing where
 * it was written.
 *
 * The server renders in its own time zone and the browser in the learner's, so
 * the two can differ by a day near midnight; the browser's is the true one, and
 * the hydration warning for that one text node is expected.
 *
 * In the page's language: "19 Oct 2026", "19 thg 10, 2026", "19 oct 2026".
 * English stays en-GB (day first), for the reason above.
 */
import { useTranslation } from "react-i18next";

const DATE_LOCALES: Record<string, string> = { en: "en-GB", vi: "vi-VN", es: "es-ES", pt: "pt-BR" };

/** The Intl locale for an interface language. */
export function dateLocale(language: string): string {
  return DATE_LOCALES[language] ?? "en-GB";
}

export function formatDate(iso: string, withTime = false, language = "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(dateLocale(language), {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function DateText({ iso, withTime = false, className }: { iso: string; withTime?: boolean; className?: string }) {
  const { i18n } = useTranslation();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatDate(iso, withTime, i18n.language)}
    </time>
  );
}
