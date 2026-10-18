/**
 * chart-spec.ts
 * The allow-list a `chart` fence is held to before Chart.js sees it.
 *
 * The spec is JSON a model wrote, so it is untrusted. Chart.js options can
 * carry callbacks and plugins; JSON cannot hold a function, but it can hold a
 * string that some option later evaluates or a key that turns on a plugin.
 * So nothing is passed through: a new spec is BUILT from the few fields read
 * here, and everything else is dropped. internal/capabilities/visualize holds
 * the Go port of this file; the two must agree (a test runs one fixture set
 * through both).
 */

export const CHART_TYPES = ["bar", "line", "pie", "doughnut", "scatter", "radar"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_LIMITS = { labels: 100, datasets: 8, points: 500, text: 200, source: 20_000 } as const;

export type ChartPoint = number | { x: number; y: number };

export type ChartSpec = {
  type: ChartType;
  labels: string[];
  datasets: { label: string; data: ChartPoint[] }[];
  title?: string;
  xTitle?: string;
  yTitle?: string;
  stacked: boolean;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.slice(0, CHART_LIMITS.text) : undefined;

/** Parses and validates a fence's body. null means "show it as code". */
export function parseChartSpec(source: string): ChartSpec | null {
  if (source.length > CHART_LIMITS.source) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isObj(raw) || !CHART_TYPES.includes(raw.type as ChartType)) return null;
  const type = raw.type as ChartType;
  const data = raw.data;
  if (!isObj(data) || !Array.isArray(data.datasets)) return null;

  const labelsIn = data.labels ?? [];
  if (!Array.isArray(labelsIn) || labelsIn.length > CHART_LIMITS.labels) return null;
  if (!labelsIn.every((l) => typeof l === "string" || finite(l))) return null;
  const labels = labelsIn.map((l) => String(l).slice(0, CHART_LIMITS.text));

  if (data.datasets.length === 0 || data.datasets.length > CHART_LIMITS.datasets) return null;
  const datasets: ChartSpec["datasets"] = [];
  for (const ds of data.datasets) {
    if (!isObj(ds) || !Array.isArray(ds.data) || ds.data.length > CHART_LIMITS.points) return null;
    const points: ChartPoint[] = [];
    for (const p of ds.data) {
      if (type === "scatter") {
        if (!isObj(p) || !finite(p.x) || !finite(p.y)) return null;
        points.push({ x: p.x, y: p.y });
      } else {
        if (!finite(p)) return null;
        points.push(p);
      }
    }
    datasets.push({ label: text(ds.label) ?? `Series ${datasets.length + 1}`, data: points });
  }

  const options = isObj(raw.options) ? raw.options : {};
  const plugins = isObj(options.plugins) ? options.plugins : {};
  const title = isObj(plugins.title) ? text(plugins.title.text) : text(options.title);
  const scales = isObj(options.scales) ? options.scales : {};
  const axisTitle = (axis: unknown) => (isObj(axis) && isObj(axis.title) ? text(axis.title.text) : undefined);
  const stacked = [scales.x, scales.y].some((axis) => isObj(axis) && axis.stacked === true) || options.stacked === true;

  return {
    type,
    labels,
    datasets,
    title,
    xTitle: axisTitle(scales.x),
    yTitle: axisTitle(scales.y),
    stacked,
  };
}
