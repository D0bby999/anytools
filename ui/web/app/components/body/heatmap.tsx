/**
 * A year of training, a square per day, shaded by minutes trained: the
 * GitHub-style view openGym popularised. Weeks run in columns, Monday on
 * top. The shade is the brand colour at five strengths, and every square
 * carries its date and minutes as a title for pointer and screen reader.
 */
import { RefTable } from "~/components/doc/ref-table";
import { useTranslation } from "react-i18next";

export function Heatmap({ days, today }: { days: { day: string; minutes: number }[]; today: string }) {
  const { t } = useTranslation("body");
  const byDay = new Map(days.map((d) => [d.day, d.minutes]));
  const end = new Date(`${today}T00:00:00Z`);
  // Start on the Monday 52 weeks before this week's Monday.
  const monday = new Date(end);
  monday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7) - 52 * 7);
  const weeks: { day: string; minutes: number; future: boolean }[][] = [];
  for (let w = 0; w < 53; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + w * 7 + d);
      const key = date.toISOString().slice(0, 10);
      col.push({ day: key, minutes: byDay.get(key) ?? 0, future: date > end });
    }
    weeks.push(col);
  }
  const shade = (m: number) =>
    m === 0
      ? "bg-sunken"
      : m < 20
        ? "bg-primary/20"
        : m < 40
          ? "bg-primary/40"
          : m < 60
            ? "bg-primary/60"
            : m < 80
              ? "bg-primary/80"
              : "bg-primary";
  const trained = days.length;
  return (
    <>
      <figure data-part="practise" className="mt-3 bg-background">
        <div className="overflow-x-auto pb-2" role="img" aria-label={t("heatmap.label", { count: trained })}>
          <div className="flex gap-[3px]">
            {weeks.map((col) => (
              <div key={col[0]?.day} className="flex flex-col gap-[3px]">
                {col.map((c) => (
                  <span
                    key={c.day}
                    title={c.future ? undefined : t("heatmap.cell", { day: c.day, count: c.minutes })}
                    className={`block size-[12px] rounded-[2px] ${c.future ? "bg-transparent" : shade(c.minutes)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <figcaption className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {t("heatmap.less")}
          {[0, 10, 30, 50, 70, 90].map((m) => (
            <span key={m} aria-hidden="true" className={`block size-[12px] rounded-[2px] ${shade(m)}`} />
          ))}
          {t("heatmap.more")}
        </figcaption>
      </figure>
      <RefTable
        caption={t("heatmap.title")}
        columns={[t("up.day"), t("set.minutes")]}
        rows={days.filter((d) => d.day >= (weeks[0]?.[0]?.day ?? "") && d.day <= today).map((d) => [d.day, d.minutes])}
      />
    </>
  );
}
