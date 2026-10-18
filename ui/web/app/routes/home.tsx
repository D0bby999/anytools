/**
 * home.tsx
 * The landing surface after sign-in. It carries the world's Read column inside
 * the Operate shell and states plainly what the product cannot do yet. The
 * learning loop (phase 10) is its own destination, /loop, linked from here
 * rather than replacing this page: until a provider and a document exist,
 * "what comes first" is still the more useful thing to say.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/home";
import { requireUser } from "~/lib/auth.server";
import { getReadiness } from "~/lib/byok.server";
import { listDue } from "~/lib/mastery.server";
import { listPractice } from "~/lib/quiz.server";
import { listRetests } from "~/lib/loop.server";
import type { Readiness } from "~/lib/byok.types";
import { ReadinessCard } from "~/components/settings/readiness-card";
import { VocabDue } from "~/components/vocab/vocab-due";
import { BookCardsDue } from "~/components/vocab/book-cards-due";
import { dueCards } from "~/lib/vocab.server";
import { listStates } from "~/lib/loop.server";
import { localDay } from "~/lib/local-day";
import { isLowDay } from "~/lib/low-day.server";
import { TodayBlock, type TodayState } from "~/components/home/today-block";
import { dueWorksheets } from "~/lib/worksheets.server";
import { dueCounts, WorksheetsDue, type DueCounts } from "~/components/worksheet/worksheets-due";
import { duePathCount, ReviewAllLink } from "~/components/mastery/review-all-link";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "AnyTools" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// This loader deliberately does NOT re-fetch the user: app-layout.tsx is this
// route's parent and its loader already authenticated the request and fetched
// the profile the topbar renders. What it fetches is the one thing Home adds —
// whether the product can actually run yet.
//
// A readiness failure is swallowed into null rather than thrown. The rest of
// the page is still true and useful when the API is briefly unreachable, and an
// error boundary over the whole landing surface would be a worse answer than a
// card that says it does not know.
export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  // up-methods phase 13: the "Today" block reads the learning state updated
  // most recently (the list is ordered by updated_at), started alongside the
  // reads below. Only the fields the block shows leave this loader.
  const todayP = listStates(user.id)
    .then(({ states: [s] }): TodayState | null =>
      s
        ? {
            id: s.id,
            goal: s.goal,
            next_task: s.next_task,
            next_task_minimum: s.next_task_minimum,
            still_worth_keeping: s.minimum_contract.still_worth_keeping ?? "",
          }
        : null,
    )
    .catch((): TodayState | null => null);
  // Due is read LIVE from kp_state on every load (phase 7: due-on-read), so a
  // point failed ten minutes ago is here without any job having run. Swallowed
  // to null for the same reason readiness is.
  const [readiness, due, vocabDue, retests, bookDue, mistakes, worksheetsDue] = await Promise.all([
    getReadiness(user.id).catch((): Readiness | null => null),
    // up-methods phase 12: the paths the due points span, too, for the
    // cross-path review's link.
    listDue(user.id, 200)
      .then((d) => ({ count: d.count, paths: duePathCount(d.due) }))
      .catch((): { count: number; paths: number } | null => null),
    dueCards(user.id, 0).then((d) => d.due_count).catch((): number | null => null),
    // Skill card retests due today in the learner's zone (phase 8).
    listRetests(user.id).then((r) => r.count).catch((): number => 0),
    // A living book's flash cards due today (learning depth, phase 11).
    dueCards(user.id, 0, "book").then((d) => d.due_count).catch((): number => 0),
    // Open mistakes practisable today (learning depth, phase 1).
    listPractice(user.id).then((q) => q.remaining).catch((): number => 0),
    // Worksheet reviews due on the learner's local day (up methods, phase 0).
    dueWorksheets(user.id).then(dueCounts).catch((): DueCounts => ({ count: 0, private: 0 })),
  ]);
  const today = await todayP;
  // The low-day switch is a cookie for the learner's local day.
  const lowDay = today ? await isLowDay(request, user.id, localDay(user.timezone)) : false;
  return { readiness, due: due?.count ?? null, duePaths: due?.paths ?? 0, vocabDue, retests, bookDue, mistakes, today, lowDay, worksheetsDue };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");

  // Written as literal t() calls rather than a key built from a loop variable:
  // the i18n guard in app/test/structural-guards.test.ts can only verify keys
  // it can see, and a key it cannot see is a key that ships as raw text.
  const steps = [
    { title: t("home.next.provider.title"), body: t("home.next.provider.body") },
    { title: t("home.next.documents.title"), body: t("home.next.documents.body") },
    { title: t("home.next.ask.title"), body: t("home.next.ask.body") },
  ];

  return (
    <div className="lp-measure">
      {/* Read column: the workspace is wide, the text is not. The measure and
          the leading are the world's, ported from up. */}
      <div className="lp-prose">
        <h1>{t("home.title")}</h1>
        <p>{t("home.lead")}</p>
        <p>{t("home.body")}</p>
      </div>

      <TodayBlock today={loaderData.today} lowDay={loaderData.lowDay} />

      <section aria-labelledby="lp-next" className="mt-10">
        <h2 id="lp-next" className="lp-kicker">
          {t("home.next.title")}
        </h2>

        {/* Hairline rows, not a grid of identical cards. These are steps in one
            sequence and should read as one thing; three cards would read as
            three products. The numbers earn their place because the order is
            real: there is nothing to ask about until a document exists. */}
        <ol className="mt-4 border-t">
          {steps.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b py-4">
              <span
                aria-hidden="true"
                className="font-mono text-xs font-semibold tabular-nums text-faint"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-sans text-base font-medium">{step.title}</h3>
                <p className="mt-1 text-sm leading-prose text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* The habit this product borrows from `up`: say what is not proven
            yet, in the same voice as everything else. */}
        <p className="mt-4 text-sm leading-prose text-muted-foreground">{t("home.next.status")}</p>

        <ReadinessCard readiness={loaderData.readiness} />
      </section>

      <section aria-labelledby="lp-loop" className="mt-10">
        <h2 id="lp-loop" className="lp-kicker">
          {t("home.loop.title")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("home.loop.body")}</p>
        <Link to="/loop" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
          {t("home.loop.open")}
        </Link>
      </section>

      {loaderData.due !== null ? (
        <section aria-labelledby="lp-due" className="mt-10">
          <h2 id="lp-due" className="lp-kicker">
            {t("home.due.title")}
          </h2>
          <p className="mt-3 text-sm leading-prose text-muted-foreground">
            {loaderData.due > 0 ? t("home.due.count", { count: loaderData.due }) : t("home.due.none")}
          </p>
          <Link to="/mastery" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
            {t("home.due.open")}
          </Link>
          <ReviewAllLink count={loaderData.due} paths={loaderData.duePaths} />
          {loaderData.mistakes > 0 ? (
            <>
              <p className="mt-3 text-sm leading-prose text-muted-foreground">
                {t("home.due.mistakes", { count: loaderData.mistakes })}
              </p>
              <Link to="/quiz/practice" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
                {t("home.due.openMistakes")}
              </Link>
            </>
          ) : null}
          {loaderData.retests > 0 ? (
            <>
              <p className="mt-3 text-sm leading-prose text-muted-foreground">
                {t("home.due.retests", { count: loaderData.retests })}
              </p>
              <Link to="/loop" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
                {t("home.due.openRetests")}
              </Link>
            </>
          ) : null}
        </section>
      ) : null}

      {loaderData.vocabDue !== null ? <VocabDue count={loaderData.vocabDue} /> : null}
      <BookCardsDue count={loaderData.bookDue} />
      <WorksheetsDue {...loaderData.worksheetsDue} />
    </div>
  );
}
