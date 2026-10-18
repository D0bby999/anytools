/**
 * cycle-close-link.tsx
 * "Close this cycle" on a cycle's page (up methods, phase 10). From day 84 on
 * the learner's calendar it starts the cycle's structured day-90 close, a
 * cycle_close worksheet; once one exists it opens that one instead. Before
 * day 84 it says when it opens.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { WorksheetSummary } from "~/lib/worksheet-types";
import { canClose, closeTitle } from "~/lib/cycle-close";
import { Button } from "~/components/ui/button";

type Props = {
  /** The learning state's goal, which titles the close. */
  goal: string;
  day: number;
  closeFromDay: number;
  /** The cycle's close, when it has one. */
  close: WorksheetSummary | null;
  busy: boolean;
};

export function CycleCloseLink({ goal, day, closeFromDay, close, busy }: Props) {
  const { t } = useTranslation("loop");
  if (close) {
    return (
      <p className="mt-3 text-sm">
        <Link
          to={`/toolkit/${close.id}`}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          {close.status === "done" ? t("cycleClose.openDone") : t("cycleClose.open")}
        </Link>
      </p>
    );
  }
  if (!canClose(day, closeFromDay)) {
    return <p className="mt-3 text-sm text-muted-foreground">{t("cycleClose.notYet", { day, from: closeFromDay })}</p>;
  }
  return (
    <Form method="post" className="mt-3">
      <input type="hidden" name="intent" value="close-cycle" />
      <input type="hidden" name="title" value={closeTitle(t("cycleClose.title", { goal }))} />
      <p className="text-sm leading-prose text-muted-foreground">{t("cycleClose.lead")}</p>
      <Button type="submit" className="mt-3" disabled={busy}>
        {t("cycleClose.close")}
      </Button>
    </Form>
  );
}
