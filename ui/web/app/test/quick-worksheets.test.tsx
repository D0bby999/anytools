/**
 * quick-worksheets.test.tsx
 * Phase 5 of the private design notes: a worksheet with a quick
 * version opens on it, saves only its own fields, and opens the full
 * worksheet on request (remembered); the diagnostic's own levels show in one
 * line; a kind's link says how long its start takes.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { WorksheetForm, quickSections } from "~/components/worksheet/worksheet-form";
import { SelfEstimate } from "~/components/worksheet/self-estimate";
import { KindRow } from "~/components/worksheet/toolkit-groups";
import type { WorksheetKind } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});
afterEach(() => window.localStorage.clear());

const kind: WorksheetKind = {
  kind: "diag",
  name: "Language diagnostic",
  group: "language",
  source: "test",
  summary: "Where each skill is today.",
  private: false,
  attach: "none",
  version: 1,
  quick: [
    { section: "boundary", field: "topic" },
    { section: "cefr", field: "levels" },
  ],
  sections: [
    {
      key: "boundary",
      title: "Diagnostic boundary",
      fields: [
        { key: "topic", label: "Real topic", type: "text" },
        { key: "audience", label: "Audience", type: "text" },
      ],
    },
    { key: "scores", title: "Scores", fields: [{ key: "note", label: "A long note", type: "long" }] },
    {
      key: "cefr",
      title: "CEFR self-check",
      fields: [
        {
          key: "levels",
          label: "Where each skill is today",
          type: "table",
          row_header: "Skill",
          rows: [
            { key: "listening", label: "Listening" },
            { key: "reading", label: "Reading" },
          ],
          columns: [{ key: "level", label: "Level", type: "choice", options: ["A1", "A2", "B1", "B2", "C1", "C2", "not sure"] }],
        },
      ],
    },
  ],
};

function inRouter(el: ReactElement, posts: FormData[] = []) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: el,
      action: async ({ request }) => {
        posts.push(await request.formData());
        return null;
      },
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("the quick version", () => {
  it("shows only its fields, grouped in their sections", () => {
    expect(quickSections(kind).map((s) => [s.key, s.fields.map((f) => f.key)])).toEqual([
      ["boundary", ["topic"]],
      ["cefr", ["levels"]],
    ]);
    inRouter(<WorksheetForm worksheetId="w1" kind={kind} answers={{}} revision="r" />);
    expect(screen.getByRole("heading", { level: 2, name: "Quick version" })).toBeInTheDocument();
    expect(screen.getByLabelText("Real topic")).toBeInTheDocument();
    expect(screen.queryByLabelText("Audience")).toBeNull();
    expect(screen.queryByLabelText("A long note")).toBeNull();
  });

  it("saves only the fields it shows, so the rest of the section is kept", async () => {
    const posts: FormData[] = [];
    inRouter(
      <WorksheetForm worksheetId="w1" kind={kind} answers={{ boundary: { audience: "my team" } }} revision="r" />,
      posts,
    );
    const topic = screen.getByLabelText("Real topic");
    await userEvent.type(topic, "small talk");
    fireEvent.blur(topic);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse(String(posts[0]?.get("values")))).toEqual({ topic: "small talk" });
  });

  it("opens the full worksheet on request and remembers it", async () => {
    const { unmount } = inRouter(<WorksheetForm worksheetId="w2" kind={kind} answers={{}} revision="r" />);
    await userEvent.click(screen.getByRole("button", { name: "Open the full worksheet (3 sections)" }));
    expect(screen.getByRole("heading", { name: "2. Scores" })).toBeInTheDocument();
    unmount();
    inRouter(<WorksheetForm worksheetId="w2" kind={kind} answers={{}} revision="r" />);
    expect(await screen.findByRole("heading", { name: "2. Scores" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to the quick version" }));
    expect(screen.getByRole("heading", { level: 2, name: "Quick version" })).toBeInTheDocument();
  });
});

describe("the self-estimate", () => {
  it("names each skill's chosen level, and leaves out 'not sure'", () => {
    render(
      <SelfEstimate
        kind={kind}
        answers={{ cefr: { levels: [{ row: "listening", cells: { level: "B1" } }, { row: "reading", cells: { level: "not sure" } }] } }}
      />,
    );
    expect(screen.getByText(/Listening B1/)).toBeInTheDocument();
    expect(screen.queryByText(/Reading/)).toBeNull();
    expect(screen.getByText(/not a test result/)).toBeInTheDocument();
  });
});

describe("starting a worksheet", () => {
  it("says a kind with a quick version takes five minutes", () => {
    inRouter(
      <ul>
        <KindRow kind={kind} list={[]} />
        <KindRow kind={{ ...kind, kind: "short", name: "Short", quick: undefined }} list={[]} />
      </ul>,
    );
    expect(screen.getByRole("link", { name: /Language diagnostic/ })).toHaveTextContent("Start (5 min)");
    expect(screen.getByRole("link", { name: /Short/ })).toHaveTextContent("Start");
  });
});
