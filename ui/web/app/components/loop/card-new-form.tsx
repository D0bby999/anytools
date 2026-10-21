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
import { InputTable } from "~/components/loop/input-table";
import { DiagnosticPrompt, needsDiagnostic, type DiagnosticNeed } from "~/components/worksheet/diagnostic-prompt";

type Props = { kinds: CardKind[]; busy: boolean; diagnostic?: DiagnosticNeed };

export function CardNewForm({ kinds, busy, diagnostic }: Props) {
  const { t } = useTranslation("loop");
  const [chosen, setChosen] = useState(kinds[0]?.kind ?? "");
  const kind = kinds.find((k) => k.kind === chosen);
  if (!kind) return null;
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="newCard" />
      <fieldset>
        <legend className="text-sm font-semibold">{t("cards.chooseKind")}</legend>
        <ul className="m-0! list-none! pl-0!">
          {kinds.map((k) => (
            <li key={k.kind} className="m-0!">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
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
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {t("cards.retestAfter", { count: k.retest_delay_days })}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {diagnostic && needsDiagnostic(diagnostic, [kind.kind]) ? <DiagnosticPrompt stateId={diagnostic.stateId} /> : null}
      <InputTable
        caption={t("cards.new")}
        rows={[
          {
            id: "lp-card-title",
            label: t("cards.cardTitle"),
            control: <input id="lp-card-title" name="title" required maxLength={200} />,
          },
          ...kind.setup.map((f) => ({
            id: `lp-card-setup-${kind.kind}-${f.key}`,
            label: f.label,
            hint: f.hint,
            control: (
              <textarea
                key={`${kind.kind}:${f.key}`}
                id={`lp-card-setup-${kind.kind}-${f.key}`}
                name={`setup.${f.key}`}
                rows={2}
                required={f.required}
                maxLength={2000}
              />
            ),
          })),
        ]}
      />
      <Button type="submit" disabled={busy}>
        {t("cards.create")}
      </Button>
    </Form>
  );
}
