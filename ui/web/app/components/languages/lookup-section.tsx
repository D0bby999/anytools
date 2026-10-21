import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "~/components/doc/field";
import { lookups } from "~/lib/languages";

/** Use the same dictionary destinations as a saved word, before saving one. */
export function LookupSection({ lang }: { lang: string }) {
  const { t, i18n } = useTranslation("toolkit");
  const [term, setTerm] = useState("");
  return (
    <section aria-labelledby="lang-lookups">
      <h2 id="lang-lookups">{t("languages.practise.lookups")}</h2>
      <Field label={t("languages.practise.lookupWord")}>
        <input value={term} onChange={(event) => setTerm(event.target.value)} lang={lang} maxLength={200} />
      </Field>
      {term.trim() ? (
        <ul className="lp-dated-list">
          {lookups(lang, term, i18n.language).map((entry) => (
            <li key={entry.name}><a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.name}</a></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
