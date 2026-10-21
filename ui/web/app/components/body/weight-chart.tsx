import { RefTable } from "~/components/doc/ref-table";
import { useTranslation } from "react-i18next";
import { num, type Unit, type Weight } from "~/lib/body-types";

type Point = { day: string; value: number };

/**
 * A value over time, with an optional goal as a dashed line. An SVG drawn
 * from the numbers: no chart library for one line. `label` is the figure's
 * text alternative and its caption.
 */
export function TrendChart({
  points,
  goal,
  goalLabel,
  label,
}: {
  points: Point[];
  goal?: number | null;
  goalLabel?: string;
  label: string;
}) {
  const { t } = useTranslation("body");
  const W = 640;
  const H = 200;
  const pad = 28;
  const times = points.map((p) => Date.parse(p.day));
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, goal ?? Infinity) - 1;
  const hi = Math.max(...values, goal ?? -Infinity) + 1;
  const t0 = times[0] ?? 0;
  const t1 = Math.max(times[times.length - 1] ?? 1, t0 + 1);
  const x = (tm: number) => pad + ((tm - t0) / (t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(times[i] ?? 0).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <>
      <figure data-part="practise" className="mt-3">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
          <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="stroke-border" strokeWidth="1" />
          {goal != null ? (
            <>
              <line
                x1={pad}
                x2={W - pad}
                y1={y(goal)}
                y2={y(goal)}
                className="stroke-muted-foreground"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              {goalLabel ? (
                <text x={W - pad} y={y(goal) - 6} textAnchor="end" className="fill-muted-foreground text-xs">
                  {goalLabel}
                </text>
              ) : null}
            </>
          ) : null}
          <path d={path} fill="none" className="stroke-primary" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <circle key={`${p.day}-${i}`} cx={x(times[i] ?? 0)} cy={y(p.value)} r="3" className="fill-primary" />
          ))}
          <text x={pad} y={H - 8} className="fill-muted-foreground text-xs">
            {points[0]?.day}
          </text>
          <text x={W - pad} y={H - 8} textAnchor="end" className="fill-muted-foreground text-xs">
            {points[points.length - 1]?.day}
          </text>
        </svg>
        <figcaption className="mt-1 text-sm text-muted-foreground">{label}</figcaption>
      </figure>
      <RefTable caption={label} columns={[t("up.day"), t("up.value")]} rows={points.map((p) => [p.day, num(p.value)])} />
    </>
  );
}

/** Body weight over time, with the goal. */
export function WeightChart({ weights, goal, unit }: { weights: Weight[]; goal: number | null; unit: Unit }) {
  const { t } = useTranslation("body");
  if (weights.length < 2) {
    return (
      <>
        <p className="mt-2 text-sm text-muted-foreground">{t("weight.needTwo")}</p>
        <RefTable
          caption={t("up.dataTable")}
          columns={[t("up.day"), t("set.weight", { unit })]}
          rows={weights.map((weight) => [weight.day, num(weight.weight)])}
        />
      </>
    );
  }
  const first = weights[0]?.weight ?? 0;
  const last = weights[weights.length - 1]?.weight ?? 0;
  return (
    <TrendChart
      points={weights.map((w) => ({ day: w.day, value: w.weight }))}
      goal={goal}
      goalLabel={goal != null ? t("weight.goalLine", { goal: num(goal), unit }) : undefined}
      label={t("weight.chartLabel", { last: num(last), unit, change: (last >= first ? "+" : "") + num(last - first) })}
    />
  );
}
