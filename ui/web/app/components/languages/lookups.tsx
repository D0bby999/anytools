import { useTranslation } from "react-i18next";
import { lookups } from "~/lib/languages";

/**
 * "Look up: Jisho · Wiktionary": where to read more about a word, from its
 * language's profile (lib/languages.ts). Each opens in a new tab.
 */
export function Lookups({ lang, term, className = "" }: { lang: string; term: string; className?: string }) {
  const { t, i18n } = useTranslation("vocab");
  if (!term.trim()) return null;
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      {t("lookup.label")}{" "}
      {lookups(lang, term, i18n.language).map((l, i) => (
        <span key={l.name}>
          {i > 0 ? " · " : null}
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
            aria-label={t("lookup.in", { term, name: l.name })}
          >
            {l.name}
          </a>
        </span>
      ))}
    </p>
  );
}
