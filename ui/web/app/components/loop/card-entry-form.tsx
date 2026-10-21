/**
 * card-entry-form.tsx
 * Writing one entry on a skill evidence card: the text, how much help there
 * was, and optional links to the learner's own work. A first attempt is by
 * definition unaided, so its form does not ask.
 *
 * Links are offered from what the learner already has (this week's notes and
 * quiz answers) plus a pasted document address; the API resolves every id
 * against the learner's own rows on save and again on every read.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { PROMPT_LEVELS, type CardLinkKind, type Timepoint } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Details } from "~/components/doc/details";
import { Field } from "~/components/doc/field";
import { InputTable } from "~/components/loop/input-table";

/** Something of the learner's an entry may link to. */
export type LinkChoice = { kind: CardLinkKind; id: string; label: string };

export function CardEntryForm({ timepoint, recent, busy }: { timepoint: Timepoint; recent: LinkChoice[]; busy: boolean }) {
  const { t } = useTranslation("loop");
  const levels: Record<string, string> = {
    unaided: t("cards.level.unaided"),
    light_cue: t("cards.level.light_cue"),
    heavy_cue: t("cards.level.heavy_cue"),
  };
  const kinds: Record<CardLinkKind, string> = {
    note: t("cards.linkKind.note"),
    document: t("cards.linkKind.document"),
    quiz_attempt: t("cards.linkKind.quiz_attempt"),
  };
  const baseline = timepoint === "baseline";
  return (
    <Form method="post" className="mt-4">
      <input type="hidden" name="intent" value="entry" />
      <input type="hidden" name="timepoint" value={timepoint} />
      {baseline ? <p className="text-muted-foreground">{t("cards.baselineWarning")}</p> : null}
      {baseline ? <input type="hidden" name="prompt_level" value="unaided" /> : null}
      <InputTable
        caption={t("cards.write")}
        rows={[
          {
            id: `lp-entry-${timepoint}`,
            label: t("cards.write"),
            hint: t("cards.writeHint"),
            control: <textarea id={`lp-entry-${timepoint}`} name="body" required rows={baseline ? 8 : 5} maxLength={20000} />,
          },
          ...(baseline
            ? []
            : [
                {
                  id: `lp-entry-${timepoint}-level`,
                  label: t("cards.promptLevel"),
                  control: (
                    <select id={`lp-entry-${timepoint}-level`} name="prompt_level" defaultValue="unaided">
                      {PROMPT_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {levels[l]}
                        </option>
                      ))}
                    </select>
                  ),
                },
              ]),
        ]}
      />
      <Details summary={t("cards.links")}>
        {recent.length > 0 ? (
          <fieldset>
            <legend className="text-sm text-muted-foreground">{t("cards.linkRecent")}</legend>
            <ul className="m-0! list-none! pl-0!">
              {recent.map((c) => (
                <li key={`${c.kind}:${c.id}`}>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="link" value={`${c.kind}:${c.id}`} />
                    <span className="line-clamp-1">
                      <span className="text-faint">{kinds[c.kind]}: </span>
                      {c.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        <Field label={t("cards.linkDocument")} hint={t("cards.linkDocumentHint")}>
          <input name="document_url" maxLength={500} />
        </Field>
      </Details>
      <Button type="submit" disabled={busy}>
        {t("cards.save")}
      </Button>
    </Form>
  );
}
