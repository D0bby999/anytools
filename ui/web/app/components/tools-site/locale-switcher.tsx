import { Link, useLocation, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { publicLngs, type PublicLng } from "~/lib/i18n";
import { cn } from "~/lib/utils";

/** Each language in its own name, so a reader finds theirs without reading ours. */
export const LOCALE_NAMES: Record<PublicLng, string> = {
  en: "English",
  vi: "Tiếng Việt",
  es: "Español",
  pt: "Português",
};

/**
 * The same page in another language: four plain links rather than a menu, so
 * it works before hydration and needs no focus management. A page that exists
 * in fewer languages (an English-only tool) says so in its loader data as
 * `locales`, and only those are offered: the others would 404.
 */
export function LocaleSwitcher({ locale }: { locale: PublicLng }) {
  const { t } = useTranslation("tools");
  const { pathname, search } = useLocation();
  const matches = useMatches();
  const offered =
    [...matches]
      .reverse()
      .map((m) => (m.data as { locales?: PublicLng[] } | undefined)?.locales)
      .find((l) => Array.isArray(l)) ?? publicLngs;
  const rest = pathname.slice(`/${locale}`.length);

  return (
    <nav aria-label={t("site.language")}>
      <ul className="flex items-center gap-1">
        {publicLngs
          .filter((l) => offered.includes(l))
          .map((l) => (
            <li key={l}>
              <Link
                to={`/${l}${rest}${search}`}
                lang={l}
                hrefLang={l}
                title={LOCALE_NAMES[l]}
                aria-current={l === locale ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 font-mono text-xs uppercase",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  l === locale
                    ? "bg-selected font-semibold text-selected-foreground"
                    : "text-muted-foreground hover:bg-primary-soft hover:text-foreground",
                )}
              >
                <span aria-hidden="true">{l}</span>
                <span className="sr-only">{LOCALE_NAMES[l]}</span>
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}
