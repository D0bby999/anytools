import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { learnPrefill, type Decision, type Term, type VocabNote, type Week } from "~/lib/vocab-types";
import { Button } from "~/components/ui/button";
import { DecisionFields } from "~/components/vocab/decision-picker";
import { WeekNotice } from "~/components/vocab/week-notice";
import { Lookups } from "~/components/languages/lookups";
import { COMMON_LANGUAGES, isLanguageCode, languageName } from "~/lib/languages";

type TermsData = { terms?: Term[]; lang?: string; existing?: VocabNote[]; errorKey?: string; errorDetail?: string };
type SaveData = {
  savedWord?: boolean;
  created?: boolean;
  /** The answer to a decision change (PATCH), not a save. */
  changed?: boolean;
  note?: VocabNote;
  week?: Week;
  errorKey?: string;
  errorDetail?: string;
};

/**
 * "Find words to save" under a vocabulary answer. The prose answer above is
 * the tutor's; this asks the reading model once more, for the terms as data
 * (readingapi POST /terms, one billed call — said on the button's hint), and
 * lists them. The server saves a term only if it is in the selection and the
 * selection is on the page, so what is listed here is already known to pass.
 *
 * Each term is listed WITHOUT its meaning (up-methods phase 3, up's
 * "inference before lookup"): the learner first picks one of the five
 * decisions and writes its minimum record, and only then is the suggested
 * meaning shown — for Infer, only after a candidate sense of their own. A
 * term already saved shows its decision and offers to change it, which is a
 * PATCH: saving it again would only add the sentence.
 *
 * The common case is one click (the private design notes, phase 3):
 * "Learn this word" saves it to learn with the meaning in the learner's own
 * language and the sound, collocation and cue the model proposed. "Other
 * ways to keep it" opens the five decisions, prefilled the same way.
 */
export function WordPicker({ selection, page }: { selection: string; page: number }) {
  const { t } = useTranslation("vocab");
  const finder = useFetcher<TermsData>();
  const [lang, setLang] = useState<string | null>(null);
  const data = finder.data;
  const shownLang = lang ?? data?.lang ?? "";

  if (!data?.terms) {
    return (
      <div className="mt-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={finder.state !== "idle"}
          aria-describedby="lp-picker-cost"
          onClick={() => finder.submit({ intent: "terms", selection, page: String(page) }, { method: "post" })}
        >
          {finder.state !== "idle" ? t("picker.finding") : t("picker.find")}
        </Button>
        <p id="lp-picker-cost" className="mt-1 text-xs text-muted-foreground">
          {t("picker.cost")}
        </p>
        {data?.errorKey ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {t("picker.failed")} {data.errorDetail}
          </p>
        ) : null}
      </div>
    );
  }

  const existing = data.existing ?? [];
  return (
    <section aria-label={t("picker.title")} className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="lp-section">{t("picker.title")}</h3>
        <LanguageField value={shownLang} detected={data.lang ?? ""} onChange={setLang} />
      </div>
      {data.terms.length === 0 ? (
        <p className="mt-2 lp-empty">{t("picker.none")}</p>
      ) : (
        <ul className="mt-2 border-t">
          {data.terms.map((term) => (
            <TermRow
              key={term.term}
              term={term}
              selection={selection}
              page={page}
              lang={shownLang}
              saved={existing.find(
                (n) => n.term.toLowerCase() === term.term.toLowerCase() && (!shownLang || n.lang === shownLang),
              )}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TermRow({
  term,
  selection,
  page,
  lang,
  saved,
}: {
  term: Term;
  selection: string;
  page: number;
  lang: string;
  saved?: VocabNote;
}) {
  const { t } = useTranslation("vocab");
  const saver = useFetcher<SaveData>();
  const result = saver.data?.note;
  // The note this row now stands for: the one the server answered with, or
  // the one found when the terms were listed.
  const note = result ?? saved;
  const [changing, setChanging] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const deciding = (!note && choosing) || changing;
  const prefill = learnPrefill(term, selection);
  const meaning = term.gloss || term.meaning;
  const busy = saver.state !== "idle";
  const done = saver.state === "idle" && saver.data?.savedWord === true;
  // A change closes the form once the server has taken it.
  useEffect(() => {
    if (done) {
      setChanging(false);
      setChoosing(false);
    }
  }, [done, saver.data]);

  let status: string | null = null;
  if (note) {
    const decision = t(`decide.options.${note.decision satisfies Decision}`);
    status = !saver.data?.savedWord
      ? t("decide.already", { decision })
      : saver.data.changed
        ? t("decide.changed", { decision })
        : saver.data.created
          ? note.decision === "learn"
            ? t("decide.savedToday")
            : t("decide.savedAs", { decision })
          : t("decide.already", { decision });
  }

  return (
    <li className="border-b py-3">
      <p className="text-sm font-medium" lang={lang || undefined} dir="auto">
        {term.term}
        {term.pos ? <span className="ml-2 font-mono text-2xs text-muted-foreground">{term.pos}</span> : null}
      </p>
      {isLanguageCode(lang) ? <Lookups lang={lang} term={term.term} className="mt-0.5" /> : null}
      {status && !changing ? (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {status}
        </p>
      ) : null}
      {saver.data?.week ? <WeekNotice week={saver.data.week} /> : null}

      {!note && !choosing ? (
        <saver.Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="save-word" />
          <input type="hidden" name="selection" value={selection} />
          <input type="hidden" name="page" value={String(page)} />
          <input type="hidden" name="term" value={term.term} />
          <input type="hidden" name="pos" value={term.pos ?? ""} />
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="decision" value="learn" />
          <input type="hidden" name="meaning" value={meaning} />
          {Object.entries(prefill).map(([k, v]) => (
            <input key={k} type="hidden" name={`record_${k}`} value={v} />
          ))}
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? t("decide.saving") : t("picker.learnIt")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setChoosing(true)}>
            {t("picker.otherWays")}
          </Button>
        </saver.Form>
      ) : deciding ? (
        <saver.Form method="post">
          <input type="hidden" name="intent" value={note ? "decide-word" : "save-word"} />
          {note ? <input type="hidden" name="id" value={note.id} /> : null}
          <input type="hidden" name="selection" value={selection} />
          <input type="hidden" name="page" value={String(page)} />
          <input type="hidden" name="term" value={term.term} />
          <input type="hidden" name="pos" value={term.pos ?? ""} />
          <input type="hidden" name="lang" value={lang} />
          <DecisionFields
            suggestion={note?.meaning || meaning}
            passageMeaning={note ? undefined : term.meaning}
            prefill={note ? undefined : prefill}
            lang={lang || undefined}
            initial={
              note
                ? { decision: note.decision, record: note.record, meaning: note.meaning, task_impact: note.task_impact }
                : undefined
            }
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? t("decide.saving") : t("decide.save")}
            </Button>
            {changing || choosing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setChanging(false);
                  setChoosing(false);
                }}
              >
                {t("decide.cancel")}
              </Button>
            ) : null}
          </div>
        </saver.Form>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setChanging(true)}>
          {t("decide.change")}
        </Button>
      )}
      {saver.data?.errorKey ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("decide.failed")} {saver.data.errorDetail}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The words' language, by name: the one detected on the page first, then the
 * often learned; "Other…" opens a code box for the rest (Languages, phase 1).
 */
function LanguageField({ value, detected, onChange }: { value: string; detected: string; onChange: (l: string) => void }) {
  const { t, i18n } = useTranslation("vocab");
  const options = [...new Set([detected, ...COMMON_LANGUAGES].filter(Boolean))];
  const [other, setOther] = useState(value !== "" && !options.includes(value));
  const control = "h-8 rounded-md border border-control-border bg-card px-2 text-xs text-foreground";
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-2">
        {t("picker.language")}
        <select
          value={other ? "" : value}
          onChange={(e) => {
            const v = e.target.value;
            setOther(v === "");
            if (v) onChange(v);
          }}
          className={control}
        >
          {options.map((l) => (
            <option key={l} value={l}>
              {languageName(l, i18n.language)}
            </option>
          ))}
          <option value="">{t("picker.otherLanguage")}</option>
        </select>
      </label>
      {other ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={11}
          aria-label={t("picker.languageCode")}
          className={`${control} w-16 font-mono`}
        />
      ) : null}
    </span>
  );
}
