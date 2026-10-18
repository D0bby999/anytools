/**
 * suggestion-row.tsx
 * Something the person did this week that is not yet on the review. The
 * timepoint is pre-selected from the hint (a first attempt reads as a
 * baseline, a repeat days later as a delayed check); the person can change it.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Candidate } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { useKindLabels } from "~/components/loop/evidence-row";
import { TimepointSelect } from "~/components/loop/timepoint-select";

export function SuggestionRow({ item }: { item: Candidate }) {
  const { t } = useTranslation("loop");
  const kinds = useKindLabels();
  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {item.link ? (
          <Link to={item.link} className="text-sm font-medium underline-offset-4 hover:underline">
            {item.label}
          </Link>
        ) : (
          <span className="text-sm font-medium">{item.label}</span>
        )}
        <span className="font-mono text-2xs uppercase tracking-wide text-faint">{kinds[item.kind]}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
      <Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="intent" value="addEvidence" />
        <input type="hidden" name="kind" value={item.kind} />
        <input type="hidden" name="ref_id" value={item.ref_id} />
        <TimepointSelect name="timepoint" defaultValue={item.timepoint ?? ""} allowNone label={t("evidence.timepoint")} />
        <Button type="submit" size="sm" variant="outline">
          {t("evidence.add")}
        </Button>
      </Form>
    </li>
  );
}
