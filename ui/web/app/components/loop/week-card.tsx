/**
 * week-card.tsx
 * This week's review, as the Loop home and the cycle page show it: a link to
 * the review when it exists, or the button that opens it.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { scoreText, type WeeklyReview } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Metric } from "~/components/loop/metric";

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
      <Form method="post" className="mt-3">
        <input type="hidden" name="intent" value="openReview" />
        <input type="hidden" name="cycle_id" value={cycleId} />
        <p className="text-sm leading-prose text-muted-foreground">{t("week.none", { week })}</p>
        <Button type="submit" variant="outline" className="mt-2">
          {t("week.open")}
        </Button>
      </Form>
    );
  }
  const scored = [review.completion, review.quality, review.retention, review.transfer];
  const done = scored.filter((s) => s !== null).length;
  return (
    <div className="mt-3">
      <Metric label={t("week.scored", { week: review.week_no })} value={`${done}/4`} cannotProve={cannotProve} />
      <p className="mt-2 text-sm text-muted-foreground">
        {scored.map(scoreText).join(" · ")}
        {review.writeback_done ? ` — ${t("week.writtenBack")}` : ""}
      </p>
      <Link
        to={`/loop/review/${review.id}`}
        className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        {t("week.continue")}
      </Link>
    </div>
  );
}
