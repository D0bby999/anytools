/**
 * study-focus.tsx
 * Home's first question (the private design notes, phase 7): what do
 * you want to learn? Its answer decides which parts Home lists first; a
 * learner of a language picks it, and may add its first words, which are in
 * today's review. Skip is an answer too, and the question is not asked again.
 */
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { COMMON_LANGUAGES, languageName } from "~/lib/languages";
import { STUDY_FOCUSES } from "~/lib/study-focus";

/** A language's first words, from the Library's word lists: the first level of the first list in it. */
export type StarterWords = { lang: string; list: string; level: string; name: string; count: number };

export function StudyFocusQuestion({ starters }: { starters: StarterWords[] }) {
  const { t, i18n } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formData?.get("intent") === "focus";
  const ui = (i18n.language || "en").slice(0, 2);
  const [languages, setLanguages] = useState(false);
  const [lang, setLang] = useState(ui === "en" ? "es" : "en");
  const starter = starters.find((s) => s.lang === lang);

  return (
    <section aria-labelledby="lp-focus" className="mt-6 rounded-lg border bg-card p-4">
      <h2 id="lp-focus" className="text-xl font-semibold">
        {t("home.focus.title")}
      </h2>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("home.focus.lead")}</p>
      <Form method="post" className="mt-3 grid gap-3">
        <input type="hidden" name="intent" value="focus" />
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t("home.focus.title")}</legend>
          {STUDY_FOCUSES.map((f) => (
            <label key={f} className="flex min-h-11 items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="focus"
                value={f}
                className="mt-1"
                onChange={f === "languages" ? (e) => setLanguages(e.target.checked) : undefined}
              />
              <span>
                <span className="font-medium">{t(`home.focus.options.${f}.title`)}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{t(`home.focus.options.${f}.body`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {languages ? (
          <div className="grid gap-2 rounded-md bg-sunken p-3">
            <label className="text-sm">
              {t("home.focus.which")}
              <select
                name="lang"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="mt-1 block h-10 rounded-md border border-control-border bg-card px-2 text-sm"
              >
                {COMMON_LANGUAGES.filter((code) => code !== ui).map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, i18n.language)}
                  </option>
                ))}
              </select>
            </label>
            {starter ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="starter" value={`${starter.list}:${starter.level}`} defaultChecked className="mt-1" />
                <span>{t("home.focus.starter", { count: starter.count, list: starter.name })}</span>
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t("home.focus.saving") : t("home.focus.save")}
          </Button>
          <Button type="submit" variant="ghost" name="skip" value="1" disabled={busy}>
            {t("home.focus.skip")}
          </Button>
        </div>
      </Form>
    </section>
  );
}
