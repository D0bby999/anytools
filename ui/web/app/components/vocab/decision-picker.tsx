import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CONFIDENCES,
  DECISIONS,
  MAX_RECORD,
  needsMeaning,
  RECORD_FIELDS,
  TASK_IMPACTS,
  type Decision,
} from "~/lib/vocab-types";

const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

/** What a note already holds, when its decision is being changed. */
export type DecisionInitial = {
  decision: Decision;
  record: Record<string, string>;
  meaning: string;
  task_impact: string;
};

/**
 * up's five decisions about an unknown word (vocabulary chapter §3), as form
 * fields: one decision, its minimum record, the task impact, and the
 * meaning. The parent owns the form and its submit button; the fields post
 * as `decision`, `record_<field>`, `task_impact` and `meaning`
 * (vocab-types' decisionBody reads them back).
 *
 * Inference before lookup: the suggested meaning stays hidden until a
 * decision is chosen, and for Infer until the learner has written a
 * candidate sense of their own.
 */
export function DecisionFields({
  suggestion,
  initial,
  preset,
  lang,
}: {
  /** The model's meaning, or the note's own. */
  suggestion: string;
  initial?: DecisionInitial;
  /** Start on this decision, as "Learn this" does. */
  preset?: Decision;
  lang?: string;
}) {
  const { t } = useTranslation("vocab");
  const id = useId();
  const [decision, setDecision] = useState<Decision | null>(preset ?? initial?.decision ?? null);
  const own = (d: Decision) => (initial?.decision === d ? initial.record : {});
  const [sense, setSense] = useState(own("infer").sense ?? "");
  const [meaning, setMeaning] = useState(initial?.meaning || suggestion);

  const revealed = decision !== null && (decision !== "infer" || sense.trim() !== "");

  return (
    <div className="mt-2">
      <fieldset>
        <legend className="text-xs text-muted-foreground">{t("decide.legend")}</legend>
        <p className="mt-1 text-xs leading-snug text-faint">{t("decide.hint")}</p>
        <div className="mt-2 grid gap-1">
          {DECISIONS.map((d) => (
            <label key={d} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm">
              <input
                type="radio"
                name="decision"
                value={d}
                checked={decision === d}
                onChange={() => setDecision(d)}
                required
                className="mt-1"
                aria-describedby={`${id}-when-${d}`}
              />
              <span>
                <span className="font-medium">{t(`decide.options.${d}`)}</span>
                <span id={`${id}-when-${d}`} className="block text-xs leading-snug text-muted-foreground">
                  {t(`decide.when.${d}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {decision ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {RECORD_FIELDS[decision].map((f) =>
            f === "confidence" ? (
              <label key={`${decision}-${f}`} className="text-xs text-muted-foreground">
                {t(`decide.fields.${f}`)}
                <select name={`record_${f}`} required defaultValue={own(decision)[f] ?? ""} className={field}>
                  <option value="" disabled>
                    –
                  </option>
                  {CONFIDENCES.map((c) => (
                    <option key={c} value={c}>
                      {t(`decide.confidences.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div key={`${decision}-${f}`}>
                <label className="block text-xs text-muted-foreground">
                  {t(`decide.fields.${f}`)}
                  <input
                    name={`record_${f}`}
                    required
                    maxLength={MAX_RECORD}
                    {...(f === "sense"
                      ? { value: sense, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSense(e.target.value) }
                      : { defaultValue: own(decision)[f] ?? "" })}
                    aria-describedby={hintKey(f) ? `${id}-hint-${f}` : undefined}
                    lang={f === "sense" || f === "collocation" ? lang : undefined}
                    className={field}
                  />
                </label>
                {hintKey(f) ? (
                  <span id={`${id}-hint-${f}`} className="mt-1 block text-2xs leading-snug text-faint">
                    {t(`decide.fieldHints.${f}`)}
                  </span>
                ) : null}
              </div>
            ),
          )}
          {decision === "learn" ? (
            <p className="text-xs leading-snug text-muted-foreground sm:col-span-2">{t("decide.fieldHints.learnRetest")}</p>
          ) : null}

          {needsMeaning(decision) ? (
            <div className="sm:col-span-2">
              <label className="block text-xs text-muted-foreground">
                {t("decide.meaning")}
                <textarea
                  name="meaning"
                  required
                  maxLength={1000}
                  rows={2}
                  value={meaning}
                  onChange={(e) => setMeaning(e.target.value)}
                  aria-describedby={suggestion ? `${id}-note` : undefined}
                  className={field + " py-2"}
                />
              </label>
              {suggestion ? (
                <span id={`${id}-note`} className="mt-1 block text-2xs text-faint">
                  {t("decide.suggestionNote")}
                </span>
              ) : null}
            </div>
          ) : revealed ? (
            suggestion ? (
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("decide.suggestion")}</p>
                <p className="text-sm leading-prose">{suggestion}</p>
                <p className="mt-1 text-2xs text-faint">{t("decide.suggestionNote")}</p>
                <input type="hidden" name="meaning" value={meaning} />
              </div>
            ) : null
          ) : (
            <p className="text-xs text-faint sm:col-span-2">{t("decide.suggestionHidden")}</p>
          )}

          <label className="text-xs text-muted-foreground">
            {t("decide.impact")}
            <select name="task_impact" defaultValue={initial?.task_impact ?? ""} className={field}>
              <option value="">{t("decide.impactNone")}</option>
              {TASK_IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {t(`decide.impacts.${i}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function hintKey(f: string): boolean {
  return f === "sound" || f === "collocation" || f === "cue" || f === "owner";
}
