/**
 * body-today.tsx
 * Home's "Body today": the training the plan asks of today, beside the
 * studying. On a low day (the learner's bad-day switch) it asks only for ten
 * minutes of easy movement, the bad-day minimum of the body.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "~/components/ui/button";

/** The fields Home reads from Body's overview, and nothing more. */
export type BodyToday = {
  routine: string | null;
  exercises: number;
  trained: boolean;
  openId: string | null;
  thisWeek: number;
  hasPlan: boolean;
};

export function BodyTodayBlock({ body, lowDay }: { body: BodyToday; lowDay: boolean }) {
  const { t } = useTranslation("body");
  let line: string;
  if (body.openId) line = t("home.open");
  else if (body.trained) line = t("home.trained");
  else if (lowDay) line = t("home.lowDay");
  else if (body.routine) line = t("home.planned", { name: body.routine, count: body.exercises });
  else if (body.hasPlan) line = t("home.rest");
  else line = t("home.noPlan");
  return (
    <section data-part="practise" aria-labelledby="lp-home-body" className="mt-6 lp-keybox p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 id="lp-home-body" className="lp-section flex items-center gap-2 text-xl">
            {t("home.title")}
            {body.trained ? <Check aria-hidden="true" className="size-5 text-part" /> : null}
          </h2>
          <p className="mt-1 text-sm leading-snug">{line}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("week.done", { count: body.thisWeek })}</p>
        </div>
        {body.openId ? (
          <Button asChild>
            <Link to={`/body/workouts/${body.openId}`}>{t("today.resume")}</Link>
          </Button>
        ) : (
          <Button asChild variant={body.trained ? "outline" : "default"}>
            <Link to="/body">{body.hasPlan ? t("home.go") : t("home.start")}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
