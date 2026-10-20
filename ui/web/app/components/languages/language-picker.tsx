/**
 * language-picker.tsx
 * "Which languages are you learning?" (plans/261020-1535-beyond-english-
 * learning-areas, ux/01-languages.md): the languages of the learner's saved
 * words first, ticked on a first visit; then the often learned; then a search
 * over every language the browser can name. Real checkboxes, one fieldset a
 * group, posted as `lang` values to routes/languages.tsx.
 */
import { useId, useState, type FormEvent } from "react";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { ALL_LANGUAGES, COMMON_LANGUAGES, languageName, nativeName, type SavedLanguage } from "~/lib/languages";
import { Button } from "~/components/ui/button";

const ROW = "flex min-h-11 items-center gap-3 border-b py-2 text-sm";

export function LanguagePicker({
  saved,
  studied,
  current,
  error,
}: {
  saved: SavedLanguage[];
  studied: string[];
  current: string;
  error?: string;
}) {
  const { t, i18n } = useTranslation("toolkit");
  const ui = i18n.language;
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(studied.length > 0 ? studied : saved.map((s) => s.lang)),
  );
  const [query, setQuery] = useState("");
  const [offline, setOffline] = useState(false);
  const needOneId = useId();

  const suggested = saved.map((s) => s.lang);
  const common = COMMON_LANGUAGES.filter((l) => !suggested.includes(l));
  const shown = new Set<string>([...suggested, ...common]);
  // A language ticked from the search stays on the list after the search changes.
  const otherTicked = [...ticked].filter((l) => !shown.has(l));
  const q = query.trim().toLocaleLowerCase(ui);
  const matches = q
    ? ALL_LANGUAGES.filter(
        (l) =>
          !shown.has(l) &&
          !ticked.has(l) &&
          (l === q || languageName(l, ui).toLocaleLowerCase(ui).includes(q) || nativeName(l).toLocaleLowerCase().includes(q)),
      )
    : [];

  const toggle = (l: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(l);
      else next.delete(l);
      return next;
    });

  const row = (l: string, extra?: string) => {
    const own = nativeName(l);
    // The second line says the name in the learner's language, unless it is the same.
    const local = languageName(l, ui);
    const second = [local !== own ? local : "", extra ?? ""].filter(Boolean).join(" · ");
    return (
      <li key={l}>
        <label className={ROW}>
          <input
            type="checkbox"
            name="lang"
            value={l}
            checked={ticked.has(l)}
            onChange={(e) => toggle(l, e.target.checked)}
            className="size-4"
          />
          <span className="flex flex-col">
            <span lang={l} dir="auto" className="font-medium">
              {own}
            </span>
            {second ? <span className="text-xs text-muted-foreground">{second}</span> : null}
          </span>
        </label>
      </li>
    );
  };

  const onSubmit = (e: FormEvent) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      e.preventDefault();
      setOffline(true);
    }
  };

  const none = ticked.size === 0;
  return (
    <Form method="post" action="/languages" onSubmit={onSubmit} className="mt-6">
      <input type="hidden" name="intent" value="save" />
      <h2 className="lp-section">{t("languages.picker.title")}</h2>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("languages.picker.lead")}</p>

      {saved.length > 0 ? (
        <fieldset className="mt-6">
          <legend className="text-sm font-semibold">{t("languages.picker.suggested")}</legend>
          <ul className="mt-2 border-t">
            {saved.map((s) => row(s.lang, t("languages.picker.words", { count: s.words })))}
          </ul>
        </fieldset>
      ) : null}

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">{t("languages.picker.common")}</legend>
        <ul className="mt-2 border-t">{common.map((l) => row(l))}</ul>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">{t("languages.picker.other")}</legend>
        {otherTicked.length > 0 ? <ul className="mt-2 border-t">{otherTicked.map((l) => row(l))}</ul> : null}
        <label className="mt-3 block text-sm">
          {t("languages.picker.search")}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-1 h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
          />
        </label>
        <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {q ? (matches.length > 0 ? t("languages.picker.matches", { count: matches.length }) : t("languages.picker.noMatch")) : ""}
        </p>
        {matches.length > 0 ? <ul className="mt-1 border-t">{matches.slice(0, 30).map((l) => row(l))}</ul> : null}
      </fieldset>

      {studied.length > 0 ? (
        <p className="mt-6 text-sm leading-prose text-muted-foreground">{t("languages.picker.keepsWords")}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" disabled={none || saving} aria-describedby={none ? needOneId : undefined}>
          {saving ? t("languages.picker.saving") : t("languages.picker.submit")}
        </Button>
        {current ? (
          <Link to={`/languages/${current}`} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
            {t("languages.picker.back", { name: languageName(current, ui) })}
          </Link>
        ) : null}
      </div>
      {none ? (
        <p id={needOneId} className="mt-2 text-sm text-muted-foreground">
          {t("languages.picker.needOne")}
        </p>
      ) : null}
      {offline ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("languages.picker.offline")}
        </p>
      ) : error !== undefined ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error ? t("languages.picker.failed", { cause: error }) : t("languages.picker.failedPlain")}
        </p>
      ) : null}
    </Form>
  );
}
