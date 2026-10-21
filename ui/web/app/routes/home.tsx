/**
 * home.tsx
 * The landing surface after sign-in. It carries the world's Read column inside
 * the Operate shell and states plainly what the product cannot do yet. The
 * learning loop (phase 10) is its own destination, /loop, linked from here
 * rather than replacing this page: until a provider and a document exist,
 * "what comes first" is still the more useful thing to say.
 */
import { Link, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/home";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { getReadiness, listConnections } from "~/lib/byok.server";
import { listKBs } from "~/lib/kb.server";
import { listSessions } from "~/lib/chat.server";
import { listDue } from "~/lib/mastery.server";
import { listPractice } from "~/lib/quiz.server";
import { listRetests } from "~/lib/loop.server";
import type { Readiness } from "~/lib/byok.types";
import { ReadinessCard } from "~/components/settings/readiness-card";
import { dueCards } from "~/lib/vocab.server";
import { listStates } from "~/lib/loop.server";
import { localDay } from "~/lib/local-day";
import { isLowDay } from "~/lib/low-day.server";
import { InstallHint } from "~/components/reminders/install-hint";
import { type BodyToday } from "~/components/body/body-today";
import { getOverview } from "~/lib/body.server";
import { TodayBlock, type TodayState } from "~/components/home/today-block";
import { dueWorksheets } from "~/lib/worksheets.server";
import { dueCounts, WorksheetsDue, type DueCounts } from "~/components/worksheet/worksheets-due";
import { duePathCount, ReviewAllLink } from "~/components/mastery/review-all-link";
import { PageHeader } from "~/components/ui/page-header";
import { Plate } from "~/components/ui/plate";
import { RightPanel } from "~/components/layout/right-panel";
import { NAV_TREE, flatEntries } from "~/lib/nav-tree";
import { PARTS } from "~/lib/parts";
import { QuickStart } from "~/components/doc/quick-start";
import { BookMeta } from "~/components/doc/book-meta";
import { GuidePaths } from "~/components/doc/guide-paths";
import { RefTable } from "~/components/doc/ref-table";
import { Details } from "~/components/doc/details";
import type { loader as shellLoader } from "~/routes/app-layout";

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
      // A general deck's cards due today (the private design notes, phase 5).
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

const LEARNING_GROUP_IDS = new Set(["read", "ask", "practise", "reflect"]);

function descriptionKey(labelKey: string) {
  return `home.up.descriptions.${labelKey.split(".").pop()}`;
}

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

  const shell = useRouteLoaderData<typeof shellLoader>("routes/app-layout");
  const nextSetup = !ready && !setupDone ? steps.find((step) => !step.done) : undefined;
  const primary = nextSetup
    ? { to: nextSetup.to, label: nextSetup.go }
    : due && due > 0
      ? { to: duePaths > 1 ? "/mastery/review" : "/mastery", label: t("home.due.review") }
      : { to: today ? `/loop/state/${today.id}` : "/loop", label: t("home.noGoal.open") };
  const dueRows: React.ReactNode[][] = [];

  if (due) {
    dueRows.push([
      t("home.due.count", { count: due }),
      due,
      <div className="flex flex-wrap gap-x-4">
        <Link to="/mastery" className={LINK}>
          {t("home.due.open")}
        </Link>
        <ReviewAllLink count={due} paths={duePaths} />
      </div>,
    ]);
  }
  if (mistakes > 0) {
    dueRows.push([
      t("home.due.mistakes", { count: mistakes }),
      mistakes,
      <Link to="/quiz/practice" className={LINK}>
        {t("home.due.openMistakes")}
      </Link>,
    ]);
  }
  if (retests > 0) {
    dueRows.push([
      t("home.due.retests", { count: retests }),
      retests,
      <Link to="/loop" className={LINK}>
        {t("home.due.openRetests")}
      </Link>,
    ]);
  }
  if (vocabDue) dueRows.push([t("vocab:home.title"), vocabDue, <Link to="/mastery/vocabulary" className={LINK}>
        {t("vocab:home.open")}
      </Link>]);
  if (bookDue > 0) dueRows.push([t("vocab:bookCards.home.title"), bookDue, <Link to="/mastery/book-cards" className={LINK}>
        {t("vocab:bookCards.home.open")}
      </Link>]);
  if (deckDue > 0) dueRows.push([t("vocab:decks.home.title"), deckDue, <Link to="/mastery/decks" className={LINK}>
        {t("vocab:decks.home.open")}
      </Link>]);
  if (worksheetsDue.count > 0 || worksheetsDue.private > 0) {
    dueRows.push([
      t("toolkit:home.title"),
      worksheetsDue.count + worksheetsDue.private,
      <WorksheetsDue {...worksheetsDue} />,
    ]);
  }
  if (body) {
    let status = t("body:home.noPlan");
    if (body.openId) status = t("body:home.open");
    else if (body.trained) status = t("body:home.trained");
    else if (lowDay) status = t("body:home.lowDay");
    else if (body.routine) status = t("body:home.planned", { name: body.routine, count: body.exercises });
    else if (body.hasPlan) status = t("body:home.rest");

    const destination = body.openId ? `/body/workouts/${body.openId}` : "/body";
    const action = body.openId
      ? t("body:today.resume")
      : body.hasPlan
        ? t("body:home.go")
        : t("body:home.start");

    dueRows.push([
      <div>
        {t("body:home.title")}
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>,
      t("body:week.done", { count: body.thisWeek }),
      <Link className={LINK} to={destination}>
        {action}
      </Link>,
    ]);
  }

  const learningGroups = NAV_TREE.filter((group) => LEARNING_GROUP_IDS.has(group.id));
  const guideEntries = flatEntries();
  const appendix = NAV_TREE.find((group) => group.id === "appendix");
  const entryRows: React.ReactNode[][] = [];

  for (const group of learningGroups) {
    const firstPage = group.items[0];
    if (!firstPage) continue;
    entryRows.push([
      t(`home.up.entries.${group.id}.situation`),
      <Link to={firstPage.to} className={LINK}>
        {t(firstPage.labelKey)}
      </Link>,
      t(`home.up.entries.${group.id}.keep`),
    ]);
  }

  return (
    <div className="min-w-0">
      <PageHeader title={t("home.title")} lede={shell?.displayName ? t("home.up.greeting", { name: shell.displayName }) : t("home.lead")} />
      <QuickStart
        kicker={t("home.up.nextStep")}
        title={nextSetup?.title ?? (today ? today.goal : t("home.noGoal.title"))}
        description={nextSetup?.body ?? t(today ? "home.lead" : "home.noGoal.body")}
        primary={primary}
        secondary={[{ to: "/knowledge", label: t("nav.knowledge") }, { to: "/chat", label: t("nav.chat") }]}
        cycle={t("home.up.cycle")}
        steps={nextSetup ? steps.map((step) => ({ label: step.title, done: step.done, to: step.to })) : undefined}
        stepsLabel={t("home.next.title")}
        doneLabel={t("home.next.done")}
      />
      <section aria-labelledby="lp-due">
        <h2 id="lp-due" className="text-2xl font-semibold">
          {t("home.up.dueToday")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {total > 0 ? t("home.due.total", { count: total }) : t("home.due.clear")}
        </p>
        {dueRows.length > 0 ? (
          <RefTable
            caption={t("home.up.dueToday")}
            columns={[t("home.up.task"), t("home.up.count"), t("home.up.open")]}
            rows={dueRows}
          />
        ) : null}
        {total === 0 ? (
          <p className="flex flex-wrap gap-x-5">
            <Link to="/mastery" className={LINK}>
              {t("home.due.open")}
            </Link>
            <Link to="/mastery/vocabulary" className={LINK}>
              {t("vocab:home.open")}
            </Link>
          </p>
        ) : null}
        {total === 0 && !lowDay ? <Plate name="done-today" sizes="10rem" className="hidden max-w-40 sm:block" /> : null}
      </section>
      <BookMeta
        label={t("home.up.facts")}
        items={[
          { label: t("home.due.total", { count: total }) },
          ...(today ? [{ label: today.goal, to: `/loop/state/${today.id}` }] : []),
        ]}
      />
      <section aria-labelledby="lp-entry" className="mt-8">
        <h2 id="lp-entry" className="text-2xl font-semibold">
          {t("home.up.entry")}
        </h2>
        <RefTable
          caption={t("home.up.entry")}
          columns={[t("home.up.situation"), t("home.up.start"), t("home.up.keep")]}
          rows={entryRows}
        />
      </section>
      <GuidePaths
        groups={learningGroups.map((group, index) => ({
          id: group.id,
          kicker: PARTS.find((part) => part.id === group.id)?.numeral ?? String(index + 1),
          part: PARTS.find((part) => part.id === group.id)?.id,
          title: t(group.labelKey),
          description: t(`parts.${group.id}.body`),
          paths: guideEntries
            .filter((entry) => entry.group.id === group.id)
            .map(({ page }) => ({
              to: page.to,
              title: t(page.labelKey),
              description: t(descriptionKey(page.labelKey)),
            })),
        }))}
      />
      {/* Appendix destinations leave the app router, so these cards use document links. */}
      {appendix ? (
        <section
          className="lp-guide-path-group mt-5"
          data-variant="external"
          data-part="tools"
          aria-labelledby="guide-appendix"
        >
          <div className="lp-guide-path-group-heading">
            <h2 id="guide-appendix">{t(appendix.labelKey)}</h2>
          </div>
          <ul className="lp-guide-path-group-items">
            {appendix.items.map((page) => (
              <li key={page.to}>
                <a href={page.to} className="lp-guide-path">
                  <strong>{t(page.labelKey)}</strong>
                  {t(descriptionKey(page.labelKey))}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {today ? (
        <div className="mt-8">
          <TodayBlock today={today} lowDay={lowDay} />
        </div>
      ) : null}
      <Details summary={t("home.up.setup")} className="mt-8">
        <InstallHint />
        {!ready ? <ReadinessCard readiness={readiness} /> : null}
      </Details>

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

// Every LINK here sits in a table cell: a text link on the cell's first line
// (a 44px box centred its text 10px below the row's other cells), with an
// invisible 48px hit area so a finger still finds it.
const LINK = "relative text-sm leading-6 font-medium text-primary underline underline-offset-4 hover:text-primary-hover after:absolute after:inset-x-0 after:-inset-y-3";
