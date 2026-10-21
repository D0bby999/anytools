/**
 * suggestion-row.tsx
 * Something the person did this week that is not yet on the review. The
 * timepoint is pre-selected from the hint (a first attempt reads as a
 * baseline, a repeat days later as a delayed check); the person can change it.
 * A line of a plain list: the label, its kind, its detail, then the form.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Candidate } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { useKindLabels } from "~/components/loop/evidence-row";
import { TimepointSelect } from "~/components/loop/timepoint-select";
import { NOTE_JOIN } from "~/lib/sentence";

export function SuggestionRow({ item }: { item: Candidate }) {
  const { t } = useTranslation("loop");
  const kinds = useKindLabels();
  return (
    <li>
      {item.link ? <Link to={item.link}>{item.label}</Link> : <span>{item.label}</span>}
      {NOTE_JOIN}
      {kinds[item.kind]}
      {item.detail ? <span className="block text-sm text-muted-foreground">{item.detail}</span> : null}
      <Form method="post" className="mt-1 flex flex-wrap items-center gap-2">
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
