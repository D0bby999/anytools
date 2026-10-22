/**
 * showcase-view.tsx
 * A learner's public profile as a visitor sees it, and as the editor
 * previews it (the private design notes). The page is drawn from its
 * design: the theme on the wrapper, then each block by its view in
 * BLOCK_VIEWS. A new block type is one more entry there.
 *
 * What AnyLearn counted and what the learner wrote stay apart: the counted
 * blocks say so and the day they are counted through; the learner's own
 * words are marked as theirs.
 */
import { createContext, useContext, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { StudyCalendar } from "~/components/progress/study-calendar";
import { dayLabel } from "~/lib/day-label";
import { BLOCK_SPECS, type Block, type BlockType, type ShowcaseProfile, type ShowcaseStats } from "~/lib/showcase/design";

const LINK = "text-primary underline underline-offset-4";

type ViewProps = { block: Block; stats: ShowcaseStats; profile: ShowcaseProfile; id: string };

/** The level of a block's heading: one below the page's name. */
const SectionLevel = createContext<"h2" | "h3">("h2");

function Section({ id, title, children, note }: { id: string; title: string; children: React.ReactNode; note?: string }) {
  const Heading = useContext(SectionLevel);
  return (
    <section aria-labelledby={id} className="mt-10">
      <Heading id={id} className="lp-section">
        {title}
      </Heading>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}

function Stat({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div className="lp-keybox p-4">
      <dt className="text-sm">{label}</dt>
      <dd className="mt-1">
        <span className="lp-numeral text-4xl">{value}</span>
        {detail ? <span className="mt-1 block text-xs text-muted-foreground">{detail}</span> : null}
      </dd>
    </div>
  );
}

function SummaryView({ stats, id }: ViewProps) {
  const { t, i18n } = useTranslation("showcase");
  const s = stats.summary;
  if (!s) return null;
  const n = new Intl.NumberFormat(i18n.language);
  return (
    <Section id={id} title={t("blocks.summary.title")}>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={n.format(s.days)} label={t("summary.days", { count: s.days })} />
        <Stat value={n.format(s.streak)} label={t("summary.streak", { count: s.streak })} detail={t("summary.longest", { count: s.longest_streak })} />
        <Stat
          value={n.format(s.weeks_in_a_row)}
          label={t("summary.weeks", { count: s.weeks_in_a_row, goal: s.week_goal })}
          detail={t("summary.longestWeeks", { count: s.longest_weeks })}
        />
        <Stat value={n.format(s.level)} label={t("summary.level")} detail={t("summary.levelHow")} />
      </dl>
    </Section>
  );
}

function CalendarView({ stats, id }: ViewProps) {
  const { t } = useTranslation("showcase");
  if (!stats.calendar || !stats.as_of) return null;
  return (
    <Section id={id} title={t("blocks.calendar.title")}>
      <StudyCalendar days={stats.calendar} today={stats.as_of} />
    </Section>
  );
}

function MilestonesView({ stats, id }: ViewProps) {
  const { t, i18n } = useTranslation("showcase");
  if (!stats.milestones) return null;
  return (
    <Section id={id} title={t("blocks.milestones.title")}>
      {stats.milestones.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("milestones.none")}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {stats.milestones.map((m) => (
            <li key={`${m.kind}:${m.target}`} className="flex flex-wrap gap-x-2">
              <span className="font-semibold">{t(`progress:milestones.kinds.${m.kind}`, { count: m.target })}</span>
              <span className="text-muted-foreground">{t("progress:milestones.on", { date: dayLabel(m.reached_on, i18n.language) })}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function OutcomesView({ stats, id }: ViewProps) {
  const { t, i18n } = useTranslation("showcase");
  const o = stats.outcomes;
  if (!o) return null;
  const n = new Intl.NumberFormat(i18n.language);
  const rows: [string, number][] = [
    ["longTerm", o.long_term],
    ["mastered", o.mastered],
    ["explains", o.explains_passed],
    ["answered", o.answered],
    ["workouts", o.workouts],
  ];
  return (
    <Section id={id} title={t("blocks.outcomes.title")}>
      <dl className="mt-3 divide-y divide-border text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-4 py-2">
            <dt>{t(`outcomes.${key}`)}</dt>
            <dd className="font-semibold tabular-nums">{n.format(value)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function AboutView({ block, profile, id }: ViewProps) {
  const { t } = useTranslation("showcase");
  if (!block.body?.trim()) return null;
  return (
    <Section id={id} title={block.title?.trim() || t("blocks.about.title")} note={t("theirWords", { name: profile.name })}>
      <p className="mt-3 max-w-[64ch] whitespace-pre-line">{block.body}</p>
    </Section>
  );
}

/** An https link's host, or null; the editor's preview may hold half-typed ones. */
function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host ? u.host : null;
  } catch {
    return null;
  }
}

function LinksView({ block, profile, id }: ViewProps) {
  const { t } = useTranslation("showcase");
  const links = (block.links ?? []).filter((l) => l.label.trim() && httpsHost(l.url));
  if (links.length === 0) return null;
  return (
    <Section id={id} title={t("blocks.links.title")} note={t("theirLinks", { name: profile.name })}>
      <ul className="mt-3 space-y-2">
        {links.map((l, i) => (
          <li key={i}>
            <a href={l.url} target="_blank" rel="nofollow ugc noopener noreferrer" className={LINK}>
              {l.label}
              {" "}
              <span className="sr-only">{t("newTab")}</span>
            </a>
            <span className="ml-2 break-all text-xs text-muted-foreground">{httpsHost(l.url)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Each block type's view. A new block type is one more entry. */
export const BLOCK_VIEWS: Record<BlockType, ComponentType<ViewProps>> = {
  summary: SummaryView,
  calendar: CalendarView,
  milestones: MilestonesView,
  outcomes: OutcomesView,
  about: AboutView,
  links: LinksView,
};


export function ShowcaseView({
  profile,
  stats,
  headingLevel = 1,
  idPrefix = "lp-showcase",
}: {
  profile: ShowcaseProfile;
  stats: ShowcaseStats;
  /** The editor's preview sits under its own h1. */
  headingLevel?: 1 | 2;
  /** Prefix of the blocks' heading ids, unique on the page. */
  idPrefix?: string;
}) {
  const { t, i18n } = useTranslation("showcase");
  const Title = headingLevel === 1 ? "h1" : "h2";
  const counted = stats.as_of && profile.design.blocks.some((b) => BLOCK_SPECS[b.type].data);
  return (
    <SectionLevel.Provider value={headingLevel === 1 ? "h2" : "h3"}>
      <article data-part={profile.design.theme.accent} className="min-w-0">
        <header className="lp-keybox p-5 sm:p-6">
          <Title className="font-serif text-3xl font-semibold sm:text-4xl">{profile.name}</Title>
          {profile.headline ? <p className="mt-2 text-lg">{profile.headline}</p> : null}
          <p className="mt-3 text-sm text-muted-foreground">
            @{profile.handle}
            {stats.since ? ` · ${t("since", { date: dayLabel(stats.since, i18n.language, { month: "long", year: "numeric" }) })}` : null}
          </p>
        </header>
        {counted ? (
          <p className="mt-4 max-w-[64ch] text-sm text-muted-foreground">
            {t("counted", { name: profile.name, date: dayLabel(stats.as_of!, i18n.language) })}
          </p>
        ) : null}
        {profile.design.blocks.map((block, i) => {
          const View = BLOCK_VIEWS[block.type];
          return <View key={i} block={block} stats={stats} profile={profile} id={`${idPrefix}-${i}`} />;
        })}
      </article>
    </SectionLevel.Provider>
  );
}
