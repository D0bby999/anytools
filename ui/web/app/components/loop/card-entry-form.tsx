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

/** Something of the learner's an entry may link to. */
export type LinkChoice = { kind: CardLinkKind; id: string; label: string };

const box = "mt-1 w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm";

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
    <Form method="post" className="mt-4 space-y-3">
      <input type="hidden" name="intent" value="entry" />
      <input type="hidden" name="timepoint" value={timepoint} />
      {baseline ? <p className="text-sm text-muted-foreground">{t("cards.baselineWarning")}</p> : null}
      <label className="block text-sm font-medium">
        {t("cards.write")}
        <textarea name="body" required rows={baseline ? 8 : 5} maxLength={20000} className={box} />
        <span className="mt-1 block text-xs font-normal text-faint">{t("cards.writeHint")}</span>
      </label>
      {baseline ? (
        <input type="hidden" name="prompt_level" value="unaided" />
      ) : (
        <label className="block text-sm font-medium">
          {t("cards.promptLevel")}
          <select
            name="prompt_level"
            defaultValue="unaided"
            className="mt-1 block min-h-11 rounded-md border border-control-border bg-background px-2 text-sm"
          >
            {PROMPT_LEVELS.map((l) => (
              <option key={l} value={l}>
                {levels[l]}
              </option>
            ))}
          </select>
        </label>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-primary">{t("cards.links")}</summary>
        {recent.length > 0 ? (
          <fieldset className="mt-2">
            <legend className="text-xs text-faint">{t("cards.linkRecent")}</legend>
            <ul className="mt-1 space-y-1">
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
        <label className="mt-2 block text-sm font-medium">
          {t("cards.linkDocument")}
          <input name="document_url" maxLength={500} className={box} />
          <span className="mt-1 block text-xs font-normal text-faint">{t("cards.linkDocumentHint")}</span>
        </label>
      </details>
      <Button type="submit" disabled={busy}>
        {t("cards.save")}
      </Button>
    </Form>
  );
}
