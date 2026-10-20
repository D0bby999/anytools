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
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { getReadiness, listConnections } from "~/lib/byok.server";
import { listKBs } from "~/lib/kb.server";
import { listSessions } from "~/lib/chat.server";
import { Check } from "lucide-react";
import { listDue } from "~/lib/mastery.server";
import { listPractice } from "~/lib/quiz.server";
import { listRetests } from "~/lib/loop.server";
import type { Readiness } from "~/lib/byok.types";
import { ReadinessCard } from "~/components/settings/readiness-card";
import { VocabDue } from "~/components/vocab/vocab-due";
import { BookCardsDue } from "~/components/vocab/book-cards-due";
import { dueCards } from "~/lib/vocab.server";
import { DeckCardsDue } from "~/components/vocab/book-cards-due";
import { listStates } from "~/lib/loop.server";
import { localDay } from "~/lib/local-day";
import { isLowDay } from "~/lib/low-day.server";
import { InstallHint } from "~/components/reminders/install-hint";
import { BodyTodayBlock, type BodyToday } from "~/components/body/body-today";
import { getOverview } from "~/lib/body.server";
import { TodayBlock, type TodayState } from "~/components/home/today-block";
import { dueWorksheets } from "~/lib/worksheets.server";
import { dueCounts, WorksheetsDue, type DueCounts } from "~/components/worksheet/worksheets-due";
import { duePathCount, ReviewAllLink } from "~/components/mastery/review-all-link";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Plate } from "~/components/ui/plate";
import { RightPanel } from "~/components/layout/right-panel";
import { NAV_ITEMS } from "~/components/layout/sidebar";
import { PARTS } from "~/lib/parts";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches) },
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
  // to null for the same reason readiness is. The review reminder's push counts
  // these same rows (internal/app/wire_reminders.go); a new row goes in both.
  // Body: today's training beside the studying. Only what the block shows.
  const bodyP = getOverview(user.id)
    .then(({ overview: o }): BodyToday => {
      const routine = o.routines.find((r) => r.id === o.today.routine_id) ?? null;
      return {
        routine: routine?.name ?? null,
        exercises: routine?.exercises.length ?? 0,
        trained: o.today.trained,
        openId: o.open?.id ?? null,
        thisWeek: o.this_week,
        hasPlan: o.routines.length > 0,
      };
    })
    .catch((): BodyToday | null => null);
  const [readiness, due, vocabDue, retests, bookDue, mistakes, worksheetsDue, deckDue] = await Promise.all([
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
      // A general deck's cards due today (plans/261020-1535-beyond-english-learning-areas, phase 5).
    dueCards(user.id, 0, "cards").then((d) => d.due_count).catch((): number => 0),
]);
  // Which of the three first steps are already done, so the card can tick
  // them rather than repeat "Connect an AI account" to someone who has.
  const [hasProvider, hasDocuments, hasAsked] = await Promise.all([
    listConnections(user.id).then((r) => r.connections.length > 0).catch(() => false),
    listKBs(user.id).then((r) => r.knowledge_bases.some((k) => k.ready > 0)).catch(() => false),
    listSessions(user.id).then((r) => r.sessions.length > 0).catch(() => false),
  ]);
  const [today, body] = await Promise.all([todayP, bodyP]);
  // The low-day switch is a cookie for the learner's local day.
  const lowDay = today ? await isLowDay(request, user.id, localDay(user.timezone)) : false;
  const setup = { provider: hasProvider, documents: hasDocuments, asked: hasAsked };
  return { setup, readiness, due: due?.count ?? null, duePaths: due?.paths ?? 0, vocabDue, retests, bookDue, deckDue, mistakes, today, lowDay, worksheetsDue, body };
}

/** Home draws its own margin: the pace the book keeps, and its one claim. */
export const handle = { ownsPanel: true };

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { setup, readiness, due, duePaths, mistakes, retests, vocabDue, bookDue, deckDue, worksheetsDue, today, lowDay, body } = loaderData;
  const ready = readiness?.core === "green";
  // Written as literal t() calls rather than a key built from a loop variable:
  // the i18n guard in app/test/structural-guards.test.ts can only verify keys
  // it can see, and a key it cannot see is a key that ships as raw text.
  const steps = [
    { title: t("home.next.provider.title"), body: t("home.next.provider.body"), to: "/settings", go: t("home.next.provider.go"), done: setup.provider },
    { title: t("home.next.documents.title"), body: t("home.next.documents.body"), to: "/knowledge", go: t("home.next.documents.go"), done: setup.documents },
    { title: t("home.next.ask.title"), body: t("home.next.ask.body"), to: "/chat", go: t("home.next.ask.go"), done: setup.asked },
  ];
  const setupDone = steps.every((s) => s.done);
  const pace = t("home.margin.path", { returnObjects: true }) as string[];
  const total =
    (due ?? 0) + mistakes + retests + (vocabDue ?? 0) + bookDue + deckDue + worksheetsDue.count + worksheetsDue.private;

  return (
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)] lg:flex-row">
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-10 lg:py-10">
        <div className="lp-measure">
          <PageHeader title={t("home.title")} lede={t("home.lead")} />
          <InstallHint />

          {/* Until the three first steps are done, they are the page's first
              thing. After that, only what still cannot run, in plain words;
              nothing at all once everything core works. */}
          {!ready ? (
            setupDone ? (
              <div className="mb-8">
                <ReadinessCard readiness={readiness} />
              </div>
            ) : (
              <Setup steps={steps} />
            )
          ) : null}

          {/* Reflect: the next step of the goal touched last. */}
          <div data-part="reflect">
            {today ? (
              <div className="lp-keybox p-5 sm:p-6">
                <TodayBlock today={today} lowDay={lowDay} />
              </div>
            ) : (
              <section aria-labelledby="lp-no-goal" className="lp-keybox p-5 sm:p-6">
                <h2 id="lp-no-goal" className="lp-section">
                  {t("home.noGoal.title")}
                </h2>
                <p className="mt-2 max-w-[60ch] text-sm leading-prose text-muted-foreground">{t("home.noGoal.body")}</p>
                <Button asChild variant="outline" className="mt-4">
                  <Link to="/loop">{t("home.noGoal.open")}</Link>
                </Button>
              </section>
            )}
          </div>

          {/* Practise: everything due, behind one highlighted count. */}
          <section data-part="practise" aria-labelledby="lp-due" className="mt-6 lp-keybox p-5 sm:p-6">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <span aria-hidden="true" className="lp-numeral text-4xl">
                <span className={total > 0 ? "lp-highlight" : undefined}>{total}</span>
              </span>
              <div className="min-w-0 flex-1 basis-60">
                <h2 id="lp-due" className="lp-section text-xl">
                  {t("home.due.title")}
                </h2>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {total > 0 ? t("home.due.total", { count: total }) : t("home.due.clear")}
                </p>
              </div>
              {/* Nothing due: the day's study is closed, and the plate says so.
                  Not on a low day, whose own plate is the one in view. */}
              {total === 0 && !lowDay ? (
                <Plate name="done-today" sizes="10rem" className="hidden max-w-40 shrink-0 sm:block" />
              ) : null}
              {due !== null && due > 0 ? (
                <Button asChild>
                  <Link to={duePaths > 1 ? "/mastery/review" : "/mastery"}>{t("home.due.review")}</Link>
                </Button>
              ) : null}
            </div>

            {total > 0 ? (
              <ul className="mt-5 divide-y divide-part-line border-y border-part-line">
                {due ? (
                  <DueRow count={due} text={t("home.due.count", { count: due })}>
                    <Link to="/mastery" className={LINK}>
                      {t("home.due.open")}
                    </Link>
                    <ReviewAllLink count={due} paths={duePaths} />
                  </DueRow>
                ) : null}
                {mistakes > 0 ? (
                  <DueRow count={mistakes} text={t("home.due.mistakes", { count: mistakes })}>
                    <Link to="/quiz/practice" className={LINK}>
                      {t("home.due.openMistakes")}
                    </Link>
                  </DueRow>
                ) : null}
                {retests > 0 ? (
                  <DueRow count={retests} text={t("home.due.retests", { count: retests })}>
                    <Link to="/loop" className={LINK}>
                      {t("home.due.openRetests")}
                    </Link>
                  </DueRow>
                ) : null}
                {vocabDue ? (
                  <CountRow count={vocabDue}>
                    <VocabDue count={vocabDue} />
                  </CountRow>
                ) : null}
                {bookDue > 0 ? (
                  <CountRow count={bookDue}>
                    <BookCardsDue count={bookDue} />
                  </CountRow>
                ) : null}
                {deckDue > 0 ? (
                  <CountRow count={deckDue}>
                    <DeckCardsDue count={deckDue} />
                  </CountRow>
                ) : null}
                {worksheetsDue.count > 0 || worksheetsDue.private > 0 ? (
                  <CountRow count={worksheetsDue.count + worksheetsDue.private}>
                    <WorksheetsDue {...worksheetsDue} />
                  </CountRow>
                ) : null}
              </ul>
            ) : (
              // Nothing due: the places to go still exist, as one quiet line.
              <p className="mt-3 flex flex-wrap gap-x-5 pl-0 sm:pl-[calc(2.5rem+1.5rem)]">
                <Link to="/mastery" className={LINK}>
                  {t("home.due.open")}
                </Link>
                <Link to="/mastery/vocabulary" className={LINK}>
                  {t("vocab:home.open")}
                </Link>
              </p>
            )}
          </section>

          {/* Practise, the body: today's training, after the studying due. */}
          {body ? <BodyTodayBlock body={body} lowDay={lowDay} /> : null}

          <Contents />
        </div>
      </div>

      <RightPanel title={t("home.margin.title")}>
        <p className="mt-3 lp-margin-note">{t("home.claim")}</p>
        <p className="mt-3 lp-margin-note">{t("home.body")}</p>
        <section aria-labelledby="lp-pace" className="mt-6">
          <h3 id="lp-pace" className="lp-section">
            {t("home.margin.pathLabel")}
          </h3>
          <ol className="mt-2 space-y-2">
            {pace.map((line) => (
              <li key={line} className="font-serif text-sm leading-snug">
                {line}
              </li>
            ))}
          </ol>
        </section>
      </RightPanel>
    </div>
  );
}

const LINK = "inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

/** One line of the due list: the count in the margin of the row, then the rest. */
function CountRow({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-3 py-3">
      <span data-numeric aria-hidden="true" className="text-right font-serif text-lg font-semibold text-part">
        {count}
      </span>
      <div className="min-w-0">{children}</div>
    </li>
  );
}

/** A due line Home writes itself: the sentence, then where to go. */
function DueRow({ count, text, children }: { count: number; text: string; children: React.ReactNode }) {
  return (
    <CountRow count={count}>
      <p className="text-sm leading-snug">{text}</p>
      <div className="flex flex-wrap items-center gap-x-4">{children}</div>
    </CountRow>
  );
}

/**
 * The table of contents: the four parts, what each is for, and its sections.
 * A sequence of rows, not a grid of cards: the order is the book's.
 */
function Contents() {
  const { t } = useTranslation("common");
  return (
    <section aria-labelledby="lp-contents" className="mt-10">
      <h2 id="lp-contents" className="lp-section text-xl">
        {t("home.contents.title")}
      </h2>
      <ol className="mt-3 border-t">
        {PARTS.map((part) => (
          <li key={part.id} data-part={part.id} className="grid grid-cols-[3rem_1fr] gap-x-4 border-b py-4">
            <span aria-hidden="true" className="lp-numeral text-3xl">
              {part.numeral}
            </span>
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-semibold text-part">
                <span className="sr-only">{t("parts.part", { numeral: part.numeral })}: </span>
                {t(part.labelKey)}
              </h3>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t(part.bodyKey)}</p>
              <ul className="mt-1 flex flex-wrap gap-x-5">
                {NAV_ITEMS.filter((n) => n.part === part.id).map((n) => (
                  <li key={n.to}>
                    <Link to={n.to} className={LINK}>
                      {t(n.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Before anything runs: the three steps, in their real order, and readiness. */
type SetupStep = { title: string; body: string; to: string; go: string; done: boolean };

function Setup({ steps }: { steps: SetupStep[] }) {
  const { t } = useTranslation("common");
  // The first step not yet done is the one to do now; it alone carries a
  // button, so the card points at one thing.
  const current = steps.findIndex((s) => !s.done);
  return (
    <section aria-labelledby="lp-next" className="mb-8 lp-keybox p-5 sm:p-6">
      <h2 id="lp-next" className="lp-section text-xl">
        {t("home.next.title")}
      </h2>
      {/* Numbered because the order is real: there is nothing to ask about
          until a document exists, and nothing runs before a provider. */}
      <ol className="mt-3">
        {steps.map((step, index) => (
          <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t py-3 first:border-t-0">
            {step.done ? (
              <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-part-soft text-part">
                <Check aria-hidden="true" className="size-4" />
                <span className="sr-only">{t("home.next.done")}</span>
              </span>
            ) : (
              <span aria-hidden="true" className="font-serif text-xl font-semibold text-part">
                {index + 1}
              </span>
            )}
            <div>
              <h3 className={`font-sans text-base font-semibold ${step.done ? "text-muted-foreground" : ""}`}>
                {step.title}
              </h3>
              {step.done ? null : <p className="mt-1 text-sm leading-prose text-muted-foreground">{step.body}</p>}
              {index === current ? (
                <Button asChild size="sm" className="mt-3">
                  <Link to={step.to}>{step.go}</Link>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
