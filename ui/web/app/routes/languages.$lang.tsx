import { LookupSection } from "~/components/languages/lookup-section";
import { RefTable } from "~/components/doc/ref-table";
import { SECTION_TABS_ROW, sectionTabClass } from "~/components/ui/section-tabs";
/**
 * languages.$lang.tsx
 * One language's practice (the private design notes,
 * phase 1; ux/01-languages.md). It adds no practice of its own: the tabs of
 * the languages studied, this language's words due and the review that opens
 * them, then the diagnostic and each skill's worksheets from the Toolkit,
 * where its practice lives. Kinds come from the API, in the learner's
 * language; a kind the server does not serve is left out.
 *
 * Opening a studied language makes it the one the page opens on next time.
 */
import { useEffect, useRef } from "react";
import { Form, Link, data } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/languages.$lang";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import * as worksheets from "~/lib/worksheets.server";
import { setStudiedLanguages, studiedLanguages } from "~/lib/vocab.server";
import { isLanguageCode, languageName, languageNameInSentence, MAX_STUDIED } from "~/lib/languages";
import type { WorksheetKind } from "~/lib/worksheet-types";
import { KindRow } from "~/components/worksheet/toolkit-groups";
import { LanguageTabs } from "~/components/languages/language-tabs";
import { PageHeader } from "~/components/ui/page-header";
import { Button } from "~/components/ui/button";

export const DIAGNOSTIC = "english_diagnostic";

/** Each skill's kinds, in the order the page shows them. Vocabulary is first: it is the daily part. */
export const SKILLS = [
  { id: "listening", kinds: ["listening_audit", "listening_experiment"] },
  { id: "reading", kinds: ["reading_evidence"] },
  { id: "speaking", kinds: ["speaking_evidence", "speaking_experiment"] },
  { id: "writing", kinds: ["writing_evidence"] },
  { id: "grammar", kinds: ["grammar_error_map", "grammar_evidence"] },
  { id: "work", kinds: ["interview_evidence"] },
] as const;

/** Where a skill's practice is, beyond its worksheets. */
const PRACTICE: Partial<Record<(typeof SKILLS)[number]["id"], string>> = {
  listening: "/knowledge",
  reading: "/knowledge",
};

export function meta({ matches, data: d }: Route.MetaArgs) {
  return [{ title: appTitle(matches, d?.name ?? "Languages") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const lang = params.lang;
  if (!isLanguageCode(lang)) throw data(null, { status: 404 });
  const [languages, kinds, list] = await Promise.all([
    studiedLanguages(user.id),
    worksheets.listKinds(user.id),
    worksheets.listWorksheets(user.id),
  ]);
  const studied = languages.studied.includes(lang);
  if (studied && languages.current !== lang) {
    // The tab viewed last; a failure here only means the page opens elsewhere next time.
    await setStudiedLanguages(user.id, languages.studied, lang).catch(() => undefined);
  }
  const saved = languages.saved.find((s) => s.lang === lang);
  return {
    lang,
    studied,
    tabs: languages.studied,
    saved: languages.saved,
    words: saved?.words ?? 0,
    due: saved?.due ?? 0,
    kinds,
    list,
    name: languageName(lang, "en"),
  };
}

/** "Add to my list", for a language opened from a link. */
export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const lang = params.lang;
  if (!isLanguageCode(lang)) throw data(null, { status: 404 });
  const { studied } = await studiedLanguages(user.id);
  if (studied.includes(lang)) return { added: lang };
  // A full list says so, instead of the API's refusal as an error page.
  if (studied.length >= MAX_STUDIED) return { full: true };
  await setStudiedLanguages(user.id, [...studied, lang], lang);
  return { added: lang };
}

// In a table cell: a text link with an invisible 48px hit area (see routes/home.tsx).
const LINK = "relative text-sm leading-6 text-primary underline underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-3";

export default function Language({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("toolkit");
  const { lang, studied, tabs, saved, words, due, kinds, list } = loaderData;
  const ui = i18n.language;
  const name = languageName(lang, ui);
  const inSentence = languageNameInSentence(lang, ui);
  const byId = new Map(kinds.map((k) => [k.kind, k]));
  const diagnostic = byId.get(DIAGNOSTIC);
  // A kind that attaches to a document starts from that document, not here;
  // a listening kind's is a video or a recording.
  const start = (k: WorksheetKind) => {
    if (k.attach !== "document") return undefined;
    const from = k.document_kinds?.includes("youtube") ? "fromRecording" : "fromDocument";
    return (
      <Link to="/knowledge" className={LINK} aria-label={t(`languages.${from}Of`, { name: k.name })}>
        {t(`languages.${from}`)}
      </Link>
    );
  };
  // Switching tabs moves focus to the language's name, as a new page would;
  // the first render leaves focus where the browser put it. Compared with the
  // language before, not a first-render flag: StrictMode runs effects twice.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownLang = useRef(lang);
  useEffect(() => {
    if (shownLang.current === lang) return;
    shownLang.current = lang;
    heading.current?.focus();
  }, [lang]);
  const diagnosticTitle = diagnostic ? t("languages.diagnosticTitle", { kind: diagnostic.name, name }) : "";
  return (
    <div className="lp-doc lp-measure">
      <PageHeader title={name} lede={t("languages.lead")} />
      {tabs.length > 0 ? <LanguageTabs studied={tabs} saved={saved} /> : null}

      <h2 id="lang-name" ref={heading} tabIndex={-1} className="font-serif text-2xl font-semibold focus:outline-none">
        {name}
      </h2>
      <nav aria-label={t("languages.practise.skills")} className={SECTION_TABS_ROW}>
        {SKILLS.filter((skill) => skill.kinds.some((id) => byId.has(id)) || PRACTICE[skill.id]).map((skill) => <a key={skill.id} href={`#lang-${skill.id}`} className={sectionTabClass({ isActive: false })}>{t(`languages.skills.${skill.id}.title`)}</a>)}
        <a href="#lang-vocabulary" className={sectionTabClass({ isActive: false })}>{t("languages.skills.vocabulary.title")}</a>
      </nav>
      {!studied ? (
        <Form method="post" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm leading-prose">{t("languages.notStudied", { name: inSentence })}</p>
          <Button type="submit" variant="outline">
            {t("languages.addIt")}
          </Button>
          {actionData && "full" in actionData ? (
            <p role="alert" className="w-full text-sm text-destructive">
              {t("languages.full", { count: MAX_STUDIED })}
            </p>
          ) : null}
        </Form>
      ) : null}

      {diagnostic ? (
        <section aria-labelledby="lang-start" className="mt-10">
          <h2 id="lang-start" className="lp-section">
            {t("languages.practise.baseline")}
          </h2>
          <ol><li>{t("languages.practise.baselineOne")}</li><li>{t("languages.practise.baselineTwo")}</li><li>{t("languages.practise.baselineThree")}</li></ol>
          <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("languages.start.body")}</p>
          <ul className="mt-3 border-t">
            <KindRow kind={diagnostic} list={list} newQuery={`&title=${encodeURIComponent(diagnosticTitle)}`} />
          </ul>
        </section>
      ) : null}
      <h2>{t("languages.practise.fullDiagnostic")}</h2>
      {SKILLS.map((skill) => {
        const inSkill = skill.kinds.map((id) => byId.get(id)).filter((k): k is WorksheetKind => k !== undefined);
        const practice = PRACTICE[skill.id];
        if (inSkill.length === 0 && !practice) return null;
        return (
          <section key={skill.id} aria-labelledby={`lang-${skill.id}`} className="mt-10">
            <h2 id={`lang-${skill.id}`} className="lp-section">
              {t(`languages.skills.${skill.id}.title`)}
            </h2>
            <p className="mt-1 text-sm leading-prose text-muted-foreground">{t(`languages.skills.${skill.id}.body`)}</p>
            {practice ? (
              <Link to={practice} className={LINK}>
                {t(`languages.skills.${skill.id}.open`)}
              </Link>
            ) : null}
            {inSkill.length > 0 ? (
              <RefTable caption={t(`languages.skills.${skill.id}.title`)} columns={[t("languages.practise.worksheets")]}
                rows={inSkill.map((k) => [<ul><KindRow kind={k} list={list} start={start(k)} /></ul>])} />
            ) : null}
          </section>
        );
      })}
      <section aria-labelledby="lang-vocabulary" className="mt-8">
        <h2 id="lang-vocabulary" className="lp-section">
          {t("languages.skills.vocabulary.title")}
        </h2>
        <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("languages.skills.vocabulary.body")}</p>
        {words === 0 ? (
          <p className="mt-3 lp-empty">
            {t("languages.vocab.none", { name: inSentence })}{" "}
            <Link to="/knowledge" className="text-primary underline underline-offset-4">
              {t("languages.vocab.openKnowledge")}
            </Link>
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-prose">
              {due > 0 ? t("languages.vocab.due", { count: due, name: inSentence }) : t("languages.vocab.noneDue", { name: inSentence })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {due > 0 ? (
                <Button asChild>
                  <Link to={`/mastery/vocabulary?lang=${encodeURIComponent(lang)}#lp-vocab-due`}>
                    {t("languages.vocab.review", { count: due })}
                  </Link>
                </Button>
              ) : null}
              <Link to={`/mastery/vocabulary?lang=${encodeURIComponent(lang)}#lp-vocab-words`} className={LINK}>
                {t("languages.vocab.all", { name: inSentence })}
              </Link>
              <Link to="/mastery/vocabulary#lp-vocab-anki" className={LINK}>
                {t("languages.vocab.anki")}
              </Link>
            </div>
          </>
        )}
      </section>

      <LookupSection key={lang} lang={lang} />
      <h2>{t("languages.practise.nextStep")}</h2>
      <ul><li><Link to={`/mastery/vocabulary?lang=${encodeURIComponent(lang)}`}>{t("languages.vocab.all", { name: inSentence })}</Link></li><li><Link to="/toolkit">{t("languages.practise.worksheets")}</Link></li></ul>
    </div>
  );
}
