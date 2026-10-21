/**
 * week-card.tsx
 * This week's review, as the Loop home and the cycle page show it: a link to
 * the review when it exists, or the button that opens it. The review is one
 * line of up's dated list (P4), and its tally a Metric with its note.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { scoreText, type WeeklyReview } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Metric } from "~/components/loop/metric";
import { NOTE_JOIN } from "~/lib/sentence";

export function WeekCard({
  cycleId,
  week,
  review,
  cannotProve,
}: {
  cycleId: string;
  week: number;
  review: WeeklyReview | undefined;
  cannotProve: string;
}) {
  const { t } = useTranslation("loop");
  if (!review) {
    return (
      <Form method="post">
        <input type="hidden" name="intent" value="openReview" />
        <input type="hidden" name="cycle_id" value={cycleId} />
        <p className="text-muted-foreground">{t("week.none", { week })}</p>
        <Button type="submit" variant="outline">
          {t("week.open")}
        </Button>
      </Form>
    );
  }
  const scored = [review.completion, review.quality, review.retention, review.transfer];
  const done = scored.filter((s) => s !== null).length;
  return (
    <>
      <ul className="lp-dated-list">
        <li>
          <strong>{t("up.loop.week", { week: review.week_no })}</strong>
          {" · "}
          <Link to={`/loop/review/${review.id}`}>{t("week.continue")}</Link>
          {NOTE_JOIN}
          {scored.map(scoreText).join(" · ")}
          {review.writeback_done ? ` · ${t("week.writtenBack")}` : ""}
        </li>
      </ul>
      <Metric label={t("week.scored", { week: review.week_no })} value={`${done}/4`} cannotProve={cannotProve} />
    </>
  );
}
