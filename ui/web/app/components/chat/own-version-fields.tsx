import { useTranslation } from "react-i18next";
import {
  fieldName,
  MAX_LINE,
  OWN_VERSION_KEYS,
  type OwnVersion,
} from "~/lib/own-version";

/**
 * The three lines a learner writes before asking, when "write my own version
 * first" is on (up-methods phase 11; up's attention chapter §3).
 *
 * Controlled, so the composer can hold Send until all three are written. Each
 * field also carries a form name, so a plain form post (Solve) sends them as
 * they are.
 */
export function OwnVersionFields({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: OwnVersion;
  onChange: (next: OwnVersion) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useTranslation("ownversion");
  return (
    <fieldset className="space-y-2" aria-describedby={`${idPrefix}-hint`}>
      <legend className="lp-kicker">{t("fields.legend")}</legend>
      <p id={`${idPrefix}-hint`} className="text-xs leading-snug text-muted-foreground">
        {t("fields.hint")}
      </p>
      {OWN_VERSION_KEYS.map((key) => (
        <div key={key}>
          <label htmlFor={`${idPrefix}-${key}`} className="block text-sm font-medium">
            {t(`fields.${key}`)}
          </label>
          <textarea
            id={`${idPrefix}-${key}`}
            name={fieldName(key)}
            rows={1}
            required
            maxLength={MAX_LINE}
            disabled={disabled}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className={
              "mt-1 min-h-10 w-full resize-y rounded-md border border-control-border bg-background " +
              "px-3 py-2 text-sm leading-ui text-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
            }
          />
        </div>
      ))}
    </fieldset>
  );
}

/** The three lines as written, shown on the learner's message. */
export function OwnVersionShown({ value }: { value: OwnVersion }) {
  const { t } = useTranslation("ownversion");
  return (
    <div>
      <p className="lp-kicker">{t("shown.title")}</p>
      <dl className="mt-1 space-y-1 text-sm leading-prose">
        {OWN_VERSION_KEYS.map((key) => (
          <div key={key}>
            <dt className="text-muted-foreground">{t(`fields.${key}`)}</dt>
            <dd className="whitespace-pre-wrap">{value[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
