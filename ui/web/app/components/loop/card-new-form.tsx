/**
 * card-new-form.tsx
 * "New evidence card": choose a kind, name the card, fill in that kind's
 * setup. The kinds, their fields and their retest delays are whatever the API
 * served; this form renders them and holds no list of its own.
 */
import { useState } from "react";
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { CardKind } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { DiagnosticPrompt, needsDiagnostic, type DiagnosticNeed } from "~/components/worksheet/diagnostic-prompt";

const box = "mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm";

type Props = { kinds: CardKind[]; busy: boolean; diagnostic?: DiagnosticNeed };

export function CardNewForm({ kinds, busy, diagnostic }: Props) {
  const { t } = useTranslation("loop");
  const [chosen, setChosen] = useState(kinds[0]?.kind ?? "");
  const kind = kinds.find((k) => k.kind === chosen);
  if (!kind) return null;
  return (
    <Form method="post" className="mt-3 space-y-4">
      <input type="hidden" name="intent" value="newCard" />
      <fieldset>
        <legend className="text-sm font-medium">{t("cards.chooseKind")}</legend>
        <ul className="mt-2 border-t">
          {kinds.map((k) => (
            <li key={k.kind} className="border-b">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-3 transition-colors hover:bg-primary-soft">
                <input
                  type="radio"
                  name="kind"
                  value={k.kind}
                  checked={k.kind === chosen}
                  onChange={() => setChosen(k.kind)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{k.name}</span>
                  <span className="block text-sm text-muted-foreground">{k.summary}</span>
                  <span className="text-xs font-semibold mt-1 block text-faint">
                    {t("cards.retestAfter", { count: k.retest_delay_days })}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {diagnostic && needsDiagnostic(diagnostic, [kind.kind]) ? <DiagnosticPrompt stateId={diagnostic.stateId} /> : null}
      <label className="block text-sm font-medium">
        {t("cards.cardTitle")}
        <input name="title" required maxLength={200} className={box} />
      </label>
      {kind.setup.map((f) => (
        <label key={`${kind.kind}:${f.key}`} className="block text-sm font-medium">
          {f.label}
          <textarea name={`setup.${f.key}`} rows={2} required={f.required} maxLength={2000} className={box} />
          <span className="mt-1 block text-xs font-normal text-faint">{f.hint}</span>
        </label>
      ))}
      <Button type="submit" disabled={busy}>
        {t("cards.create")}
      </Button>
    </Form>
  );
}
