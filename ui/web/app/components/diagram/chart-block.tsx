import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseChartSpec, type ChartSpec } from "~/lib/chart-spec";
import { readDiagramTheme } from "~/lib/diagram-theme";

/**
 * A `chart` fence: a JSON spec, held to the allow-list in chart-spec.ts and
 * drawn by Chart.js on a canvas. Chart.js is loaded only when a chart is on
 * the page. The spec Chart.js receives is built here from the validated
 * fields, never the model's object, and every chart carries its numbers as a
 * table for screen readers and for checking.
 */
export function ChartBlock({ source, caption }: { source: string; caption?: string }) {
  const { t } = useTranslation("common");
  const spec = parseChartSpec(source);
  if (!spec) {
    return (
      <figure className="lp-diagram">
        <pre>
          <code>{source}</code>
        </pre>
        <figcaption className="text-xs text-muted-foreground">{t("diagram.badChart")}</figcaption>
      </figure>
    );
  }
  return <ChartCanvas spec={spec} caption={caption ?? spec.title} />;
}

function ChartCanvas({ spec, caption }: { spec: ChartSpec; caption?: string }) {
  const { t } = useTranslation("common");
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let chart: { destroy(): void } | undefined;
    let cancelled = false;
    import("chart.js/auto")
      .then(({ default: Chart }) => {
        if (cancelled || !canvas.current) return;
        const theme = readDiagramTheme();
        const colour = (i: number) => theme.series[i % Math.max(theme.series.length, 1)] ?? theme.ink;
        const round = spec.type === "pie" || spec.type === "doughnut";
        chart = new Chart(canvas.current, {
          type: spec.type,
          data: {
            labels: spec.labels,
            datasets: spec.datasets.map((ds, i) => ({
              label: ds.label,
              data: ds.data,
              backgroundColor: round ? spec.labels.map((_, j) => colour(j)) : colour(i),
              borderColor: round ? theme.paper : colour(i),
            })),
          },
          options: {
            responsive: true,
            animation: false,
            color: theme.ink,
            plugins: {
              title: { display: Boolean(spec.title), text: spec.title ?? "", color: theme.ink },
              legend: { labels: { color: theme.ink } },
            },
            scales: round
              ? {}
              : {
                  x: {
                    stacked: spec.stacked,
                    title: { display: Boolean(spec.xTitle), text: spec.xTitle ?? "", color: theme.muted },
                    ticks: { color: theme.muted },
                    grid: { color: theme.border },
                  },
                  y: {
                    stacked: spec.stacked,
                    title: { display: Boolean(spec.yTitle), text: spec.yTitle ?? "", color: theme.muted },
                    ticks: { color: theme.muted },
                    grid: { color: theme.border },
                  },
                },
          },
        } as never);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [spec]);

  return (
    <figure className="lp-diagram">
      {failed ? (
        <p className="text-xs text-muted-foreground">{t("diagram.couldNotDraw")}</p>
      ) : (
        <canvas ref={canvas} role="img" aria-label={caption || t("diagram.chartAlt")} />
      )}
      {caption ? <figcaption className="text-xs text-muted-foreground">{caption}</figcaption> : null}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">{t("diagram.data")}</summary>
        <DataTable spec={spec} />
      </details>
    </figure>
  );
}

function DataTable({ spec }: { spec: ChartSpec }) {
  const rows = Math.max(...spec.datasets.map((d) => d.data.length));
  const cell = (p: ChartSpec["datasets"][number]["data"][number] | undefined) =>
    p === undefined ? "" : typeof p === "number" ? String(p) : `(${p.x}, ${p.y})`;
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th scope="col" />
            {spec.datasets.map((d, j) => (
              <th key={j} scope="col">
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <th scope="row">{spec.labels[i] ?? i + 1}</th>
              {spec.datasets.map((d, j) => (
                <td key={j}>{cell(d.data[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
