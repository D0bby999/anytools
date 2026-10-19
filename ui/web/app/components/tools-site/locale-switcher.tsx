import { useEffect, useRef } from "react";
import { Link, useLocation, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Globe } from "lucide-react";
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
 * Closes an open `<details>` menu on a click outside it, on Escape (focus
 * returns to its button) and after a choice. Before hydration the menu still
 * opens and its links still work; it only stays open until the page changes.
 */
export function useDisclosureMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname, search]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    }
    function onKey(e: KeyboardEvent) {
      const el = ref.current;
      if (e.key !== "Escape" || !el?.open) return;
      el.open = false;
      el.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return ref;
}

/**
 * The same page in another language, as a menu: one button naming the current
 * language, opening onto the others. A `<details>` rather than a scripted
 * popover, so it opens and its links work before hydration. A page that
 * exists in fewer languages (an English-only tool) says so in its loader data
 * as `locales`, and only those are offered: the others would 404. With one
 * language left there is nothing to choose, and the menu is not drawn.
 *
 * `hrefFor` overrides the address of each language, for a page whose language
 * is not the first segment of its path (the landing page uses `/?lng=`).
 */
export function LocaleSwitcher({ locale, hrefFor }: { locale: PublicLng; hrefFor?: (l: PublicLng) => string }) {
  const { t } = useTranslation("tools");
  const { pathname, search } = useLocation();
  const matches = useMatches();
  const ref = useDisclosureMenu();
  const offered =
    [...matches]
      .reverse()
      .map((m) => (m.data as { locales?: PublicLng[] } | undefined)?.locales)
      .find((l) => Array.isArray(l)) ?? publicLngs;
  const rest = pathname.slice(`/${locale}`.length);
  const languages = publicLngs.filter((l) => offered.includes(l));
  const href = hrefFor ?? ((l: PublicLng) => `/${l}${rest}${search}`);
  if (languages.length < 2) return null;

  return (
    <nav aria-label={t("site.language")}>
      <details ref={ref} className="group relative">
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors select-none",
            "hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            "group-open:bg-hover group-open:text-foreground [&::-webkit-details-marker]:hidden",
          )}
        >
          <Globe aria-hidden="true" className="size-4" />
          <span className="sr-only">{t("site.language")}: </span>
          <span lang={locale} className="hidden md:inline">
            {LOCALE_NAMES[locale]}
          </span>
          <span lang={locale} aria-hidden="true" className="font-mono text-xs uppercase md:hidden">
            {locale}
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <ul className="absolute right-0 z-50 mt-1 min-w-44 rounded-lg border bg-card p-1 shadow-md">
          {languages.map((l) => (
            <li key={l}>
              <Link
                to={href(l)}
                lang={l}
                hrefLang={l}
                aria-current={l === locale ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  l === locale ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                <span aria-hidden="true" className="w-6 font-mono text-xs uppercase">
                  {l}
                </span>
                <span className="flex-1">{LOCALE_NAMES[l]}</span>
                {l === locale && <Check aria-hidden="true" className="size-4 text-primary" />}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
