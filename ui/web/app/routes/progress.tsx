/**
 * progress.tsx
 * Progress (the private design notes): study days, the
 * streak with its rest days, this week against the goal, the level earned by
 * study days, a year of study, the last twelve weeks, what the studying
 * produced, and milestones. Every number is counted from real study and
 * links to where it was earned; nothing is collected for its own sake.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/progress";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { getProgress, setProgressSettings, type Milestone, type Progress } from "~/lib/progress.server";
import { BookMeta } from "~/components/doc/book-meta";
import { Details } from "~/components/doc/details";
import { RefTable } from "~/components/doc/ref-table";
import { StatusLine } from "~/components/doc/status-line";
import { FIELD } from "~/components/body/fields";
import { Bar, StudyCalendar } from "~/components/progress/study-calendar";
import { dayLabel } from "~/lib/day-label";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

const LINK = "text-primary underline underline-offset-4";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Progress") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return { progress: await getProgress(user.id) };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    await setProgressSettings(user.id, { week_goal: Number(form.get("week_goal")), rest_days: Number(form.get("rest_days")) });
    return { ok: true as const };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) return { error: error.message };
    throw error;
  }
}

/** Where each milestone's evidence is. */
const EVIDENCE: Record<Milestone["kind"], string> = {
  days: "/progress#lp-progress-year",
  streak: "/progress#lp-progress-year",
  weeks: "/progress#lp-progress-weeks",
  long_term: "/mastery/vocabulary",
  mastered: "/mastery",
  reviews: "/mastery/review",
  workouts: "/body/progress",
};

export default function ProgressPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("progress");
  const p: Progress = loaderData.progress;
  const saving = useNavigation().state === "submitting";
  const number = new Intl.NumberFormat(i18n.language);
  const reached = p.milestones.filter((m) => m.reached_on);
  const next = p.milestones.filter((m) => !m.reached_on);
  const share = p.outcomes.answered > 0 ? p.outcomes.right / p.outcomes.answered : null;

  return (
    <div className="lp-doc">
      <PageHeader
        title={t("title")}
        lede={t("lede")}
        actions={
          <Link to="/showcase" className={LINK}>
            {t("showcase:fromProgress")}
          </Link>
        }
      />
      <BookMeta
        label={t("facts")}
        items={[
          { label: t("level.short", { level: p.level.level }) },
          { label: t("streak.short", { count: p.streak.current }) },
          { label: t("week.short", { days: p.week.days, goal: p.week.goal }) },
          { label: t("circles.link"), to: "/circles" },
        ]}
      />

      <section aria-labelledby="lp-progress-streak" className="mt-10">
        <h2 id="lp-progress-streak" className="lp-section">
          {t("streak.title")}
        </h2>
        <p className="mt-2 text-lg">
          {p.streak.current > 0 ? t("streak.current", { count: p.streak.current }) : t("streak.none")}{" "}
          <span className="text-muted-foreground">{t("streak.longest", { count: p.streak.longest })}</span>
        </p>
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">
          {p.streak.studied_today ? t("streak.today") : p.streak.current > 0 ? t("streak.keep") : t("streak.start")}{" "}
          {p.settings.rest_days > 0 ? t("streak.rest", { count: p.streak.rest_left, total: p.settings.rest_days }) : t("streak.noRest")}
        </p>

        <h3 className="mt-6 font-semibold">{t("week.title")}</h3>
        <p className="mt-1 text-sm">
          {t("week.days", { days: p.week.days, goal: p.week.goal })}
          {p.week.met ? ` ${t("week.met")}` : ""}
        </p>
        <Bar value={p.week.days} max={p.week.goal} label={t("week.bar", { days: p.week.days, goal: p.week.goal })} />
        <p className="mt-2 text-sm text-muted-foreground">
          {t("week.inARow", { count: p.week.in_a_row })} {t("week.longest", { count: p.week.longest })}
        </p>

        <Details summary={t("settings.title")} className="mt-4">
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              {t("settings.goal")}
              <select name="week_goal" defaultValue={p.settings.week_goal} className={FIELD}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {t("settings.goalOption", { count: n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              {t("settings.rest")}
              <select name="rest_days" defaultValue={p.settings.rest_days} className={FIELD}>
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {t("settings.restOption", { count: n })}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={saving}>
              {t("settings.save")}
            </Button>
          </Form>
          <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">{t("settings.note")}</p>
          <StatusLine tone={actionData && "error" in actionData ? "error" : "info"}>
            {actionData ? ("error" in actionData ? actionData.error : t("settings.saved")) : null}
          </StatusLine>
        </Details>
      </section>

      <section aria-labelledby="lp-progress-level" className="mt-10">
        <h2 id="lp-progress-level" className="lp-section">
          {t("level.title")}
        </h2>
        <p className="mt-2 text-lg">
          {p.level.level > 0 ? t("level.current", { level: p.level.level }) : t("level.none")}{" "}
          <span className="text-muted-foreground">{t("level.days", { count: p.level.days })}</span>
        </p>
        {p.level.next > 0 ? (
          <>
            <Bar
              value={p.level.days - p.level.from}
              max={p.level.next - p.level.from}
              label={t("level.bar", { level: p.level.level + 1 })}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              {t("level.next", { count: p.level.next - p.level.days, level: p.level.level + 1, days: p.level.next })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("level.last")}</p>
        )}
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">{t("level.how")}</p>
      </section>

      <section aria-labelledby="lp-progress-year" className="mt-10">
        <h2 id="lp-progress-year" className="lp-section">
          {t("calendar.title")}
        </h2>
        <StudyCalendar days={p.calendar} today={p.today} />
      </section>

      <section aria-labelledby="lp-progress-outcomes" className="mt-10">
        <h2 id="lp-progress-outcomes" className="lp-section">
          {t("outcomes.title")}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">{t("outcomes.lede")}</p>
        <RefTable
          caption={t("outcomes.title")}
          columns={[t("outcomes.what"), t("outcomes.count"), t("outcomes.where")]}
          rows={[
            [t("outcomes.longTerm"), t("outcomes.ofLearning", { count: p.outcomes.long_term, learning: p.outcomes.learning }), <Link key="v" to="/mastery/vocabulary" className={LINK}>{t("outcomes.open.vocab")}</Link>],
            [t("outcomes.mastered"), number.format(p.outcomes.mastered), <Link key="m" to="/mastery" className={LINK}>{t("outcomes.open.mastery")}</Link>],
            [
              t("outcomes.right"),
              share === null ? t("outcomes.noAnswers") : t("outcomes.share", { percent: Math.round(share * 100), count: p.outcomes.answered }),
              <Link key="r" to="/mastery/review" className={LINK}>{t("outcomes.open.review")}</Link>,
            ],
            [t("outcomes.answered"), number.format(p.totals.reviews + p.totals.questions), <Link key="q" to="/quiz/practice" className={LINK}>{t("outcomes.open.practice")}</Link>],
            [t("outcomes.explains"), number.format(p.outcomes.explains_passed), <Link key="e" to="/mastery" className={LINK}>{t("outcomes.open.mastery")}</Link>],
            [t("outcomes.workouts"), number.format(p.totals.workouts), <Link key="w" to="/body/progress" className={LINK}>{t("outcomes.open.body")}</Link>],
            [t("outcomes.recordings"), number.format(p.totals.recordings), <Link key="s" to="/toolkit" className={LINK}>{t("outcomes.open.toolkit")}</Link>],
            [t("outcomes.highlights"), number.format(p.totals.highlights), <Link key="h" to="/knowledge" className={LINK}>{t("outcomes.open.knowledge")}</Link>],
          ]}
        />
      </section>

      <section aria-labelledby="lp-progress-weeks" className="mt-10">
        <h2 id="lp-progress-weeks" className="lp-section">
          {t("weeks.title")}
        </h2>
        <RefTable
          caption={t("weeks.title")}
          columns={[t("weeks.week"), t("weeks.days"), t("weeks.reviews"), t("weeks.questions"), t("weeks.workouts"), t("weeks.other")]}
          rows={[...p.weeks].reverse().map((w) => [
            dayLabel(w.start, i18n.language),
            number.format(w.days),
            number.format(w.count.reviews),
            number.format(w.count.questions),
            number.format(w.count.workouts),
            number.format(w.count.explains + w.count.recordings + w.count.highlights + w.count.skill),
          ])}
        />
      </section>

      <section aria-labelledby="lp-progress-milestones" className="mt-10">
        <h2 id="lp-progress-milestones" className="lp-section">
          {t("milestones.title")}
        </h2>
        <h3 className="mt-4 font-semibold">{t("milestones.next")}</h3>
        <ul className="mt-2 space-y-4">
          {next.map((m) => (
            <li key={m.kind}>
              <p className="text-sm">{t(`milestones.kinds.${m.kind}`, { count: m.target })}</p>
              <Bar value={m.value} max={m.target} label={t(`milestones.kinds.${m.kind}`, { count: m.target })} />
              <p className="mt-1 text-xs text-muted-foreground">{t("milestones.toGo", { value: number.format(m.value), target: number.format(m.target) })}</p>
            </li>
          ))}
        </ul>
        <h3 className="mt-6 font-semibold">{t("milestones.reached")}</h3>
        {reached.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("milestones.none")}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {reached.map((m) => (
              <li key={`${m.kind}:${m.target}`}>
                <Link to={EVIDENCE[m.kind]} className={LINK}>
                  {t(`milestones.kinds.${m.kind}`, { count: m.target })}
                </Link>{" "}
                <span className="text-muted-foreground">{t("milestones.on", { date: dayLabel(m.reached_on!, i18n.language) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
