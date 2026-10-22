/**
 * A year of study, a square per day, shaded by how much was studied: the
 * same view as Body's year of training (components/body/heatmap.tsx). Weeks
 * run in columns, Monday on top; every square carries its date and count as
 * a title, and a table under it lists the days for a screen reader.
 */
import { useTranslation } from "react-i18next";
import { useOverflowTabStop } from "~/components/doc/scroll-box";
import { Details } from "~/components/doc/details";
import { RefTable } from "~/components/doc/ref-table";

const WEEKS = 53;

export function shade(count: number) {
  return count === 0
    ? "bg-sunken"
    : count < 5
      ? "bg-primary/20"
      : count < 15
        ? "bg-primary/40"
        : count < 30
          ? "bg-primary/60"
          : count < 60
            ? "bg-primary/80"
            : "bg-primary";
}

export function StudyCalendar({ days, today }: { days: { day: string; count: number }[]; today: string }) {
  const { t } = useTranslation("progress");
  const [scroller, tabIndex] = useOverflowTabStop<HTMLDivElement>();
  const byDay = new Map(days.map((d) => [d.day, d.count]));
  const end = new Date(`${today}T00:00:00Z`);
  const monday = new Date(end);
  monday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - (WEEKS - 1) * 7);
  const weeks: { day: string; count: number; future: boolean }[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + w * 7 + d);
      const key = date.toISOString().slice(0, 10);
      col.push({ day: key, count: byDay.get(key) ?? 0, future: date > end });
    }
    weeks.push(col);
  }
  return (
    <>
      <figure className="mt-3 bg-background">
        <div
          ref={scroller}
          tabIndex={tabIndex}
          className="relative overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          role="img"
          aria-label={t("calendar.label", { count: days.length })}
        >
          <div className="flex gap-[3px]">
            {weeks.map((col) => (
              <div key={col[0]?.day} className="flex flex-col gap-[3px]">
                {col.map((c) => (
                  <span
                    key={c.day}
                    title={c.future ? undefined : t("calendar.cell", { day: c.day, count: c.count })}
                    className={`block size-[12px] rounded-[2px] ${c.future ? "bg-transparent" : shade(c.count)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <figcaption className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {t("calendar.less")}
          {[0, 1, 5, 15, 30, 60].map((m) => (
            <span key={m} aria-hidden="true" className={`block size-[12px] rounded-[2px] ${shade(m)}`} />
          ))}
          {t("calendar.more")}
        </figcaption>
      </figure>
      {days.length > 0 ? (
        <Details summary={t("calendar.list")}>
          <RefTable
            caption={t("calendar.title")}
            columns={[t("calendar.day"), t("calendar.count")]}
            rows={[...days].reverse().map((d) => [d.day, d.count])}
          />
        </Details>
      ) : null}
    </>
  );
}

/** A bar from 0 to max, named for a screen reader. */
export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="mt-2 h-2 w-full max-w-md overflow-hidden rounded-full border border-border bg-sunken"
    >
      <div className="h-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}
