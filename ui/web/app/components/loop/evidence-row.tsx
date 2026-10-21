/**
 * evidence-row.tsx
 * One piece of evidence: what it points at, where it came from, and — while
 * it is only a suggestion — the person's accept or dismiss. Nothing is
 * accepted on anyone's behalf; the job proposes, the person decides.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { EvidenceKind, EvidenceRef } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { RefTable } from "~/components/doc/ref-table";
import { TimepointSelect, useTimepointLabels } from "~/components/loop/timepoint-select";

export function useKindLabels(): Record<EvidenceKind, string> {
  const { t } = useTranslation("loop");
  return {
    question_attempt: t("kind.question_attempt"),
    kp_state: t("kind.kp_state"),
    note: t("kind.note"),
    research_report: t("kind.research_report"),
    chat_message: t("kind.chat_message"),
    explain_back: t("kind.explain_back"),
    card_entry: t("kind.card_entry"),
    // up methods, phase 0: the label lives in the toolkit namespace.
    worksheet: t("evidenceKind", { ns: "toolkit" }),
  };
}

/** What a piece of evidence points at: a link when it still exists, and its detail. */
export function EvidenceLabel({ item }: { item: EvidenceRef }) {
  const { t } = useTranslation("loop");
  return (
    <>
      {item.target?.link ? (
        <Link to={item.target.link}>{item.target.label}</Link>
      ) : (
        <span>{item.target?.label ?? t("evidence.gone")}</span>
      )}
      {item.target?.detail ? <span className="block text-sm text-muted-foreground">{item.target.detail}</span> : null}
    </>
  );
}

/**
 * A review's evidence as a table (plan 261020-2246 phase 12, the "evidence
 * inventory" of up's weekly review): what it is, where it came from, and its
 * timepoint, with the accept or dismiss while it is still open.
 */
export function EvidenceTable({ items, editable }: { items: EvidenceRef[]; editable: boolean }) {
  const { t } = useTranslation("loop");
  const kinds = useKindLabels();
  const tps = useTimepointLabels();
  const statusLabel = (item: EvidenceRef) =>
    ({ suggested: t("status.suggested"), accepted: t("status.accepted"), dismissed: t("status.dismissed") })[item.status];

  return (
    <RefTable
      caption={t("review.evidence")}
      rowHeaders={false}
      columns={[t("review.evidence"), t("up.review.source"), editable ? t("evidence.timepoint") : t("up.review.when")]}
      rows={items.map((item) => [
        <EvidenceLabel key="what" item={item} />,
        <span key="source">
          {kinds[item.kind]} · {statusLabel(item)}
          {item.suggested_by === "job" ? ` · ${t("evidence.byJob")}` : ""}
        </span>,
        editable ? (
          <Form key="decide" method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="evidence" />
            <input type="hidden" name="id" value={item.id} />
            <TimepointSelect name="timepoint" defaultValue={item.timepoint} allowNone label={t("evidence.timepoint")} />
            {item.status !== "accepted" ? (
              <Button type="submit" size="sm" name="status" value="accepted">
                {t("evidence.accept")}
              </Button>
            ) : null}
            {item.status !== "dismissed" ? (
              <Button type="submit" size="sm" variant="ghost" name="status" value="dismissed">
                {t("evidence.dismiss")}
              </Button>
            ) : null}
          </Form>
        ) : item.timepoint ? (
          tps[item.timepoint]
        ) : (
          "—"
        ),
      ])}
    />
  );
}
