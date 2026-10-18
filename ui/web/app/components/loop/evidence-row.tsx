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

export function EvidenceRow({ item, editable }: { item: EvidenceRef; editable: boolean }) {
  const { t } = useTranslation("loop");
  const kinds = useKindLabels();
  const tps = useTimepointLabels();
  const statusLabel = {
    suggested: t("status.suggested"),
    accepted: t("status.accepted"),
    dismissed: t("status.dismissed"),
  }[item.status];

  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {item.target?.link ? (
          <Link to={item.target.link} className="text-sm font-medium underline-offset-4 hover:underline">
            {item.target.label}
          </Link>
        ) : (
          <span className="text-sm font-medium">{item.target?.label ?? t("evidence.gone")}</span>
        )}
        <span className="text-xs font-semibold text-faint">
          {kinds[item.kind]} · {statusLabel}
          {item.suggested_by === "job" ? ` · ${t("evidence.byJob")}` : ""}
        </span>
      </div>
      {item.target ? <p className="mt-1 text-xs text-muted-foreground">{item.target.detail}</p> : null}
      {!editable && item.timepoint ? (
        <p className="mt-1 text-xs text-muted-foreground">{tps[item.timepoint]}</p>
      ) : null}
      {editable ? (
        <Form method="post" className="mt-2 flex flex-wrap items-center gap-2">
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
      ) : null}
    </li>
  );
}
