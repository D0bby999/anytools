import { readFileSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { flatEntries } from "~/lib/nav-tree";
import type { ComponentProps } from "react";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false }));
const { default: Home } = await import("~/routes/home");
const { default: More } = await import("~/routes/more");
type Data = ComponentProps<typeof Home>["loaderData"];
const base: Data = {
  setup: { provider: true, documents: true, asked: true },
  readiness: null, due: 0, duePaths: 0, vocabDue: 0, retests: 0, bookDue: 0,
  deckDue: 0, mistakes: 0, today: null, lowDay: false,
  worksheetsDue: { count: 0, private: 0 }, body: null, progress: null, cheers: [],
};
beforeAll(() => initI18n("en"));
function show(data: Data) {
  return render(<RouterProvider router={createMemoryRouter([{
    id: "routes/app-layout", path: "/", loader: () => ({ displayName: "Learner" }),
    element: <Home loaderData={data} params={{}} matches={[] as never} />,
  }])} />);
}
it("greets the learner and puts due work before metadata and entry paths", async () => {
  const { container } = show(base);
  await screen.findByText("Welcome back, Learner.");
  const quickStart = container.querySelector(".lp-quick-start")!;
  const due = container.querySelector("#lp-due")!;
  const metadata = screen.getByRole("list", { name: "Learning at a glance" });
  const entry = screen.getByRole("table", { name: "Choose your entry point" });
  expect(quickStart.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(due.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metadata.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelectorAll('.lp-guide-path-group')).toHaveLength(5);
  for (const { group, page } of flatEntries()) {
    if (["read", "ask", "practise", "reflect", "appendix"].includes(group.id)) {
      expect(container.querySelector(`.lp-guide-path[href="${page.to}"]`), page.to).toBeTruthy();
    }
  }
  expect(screen.getByText("Finish setting up").closest("details")).not.toHaveAttribute("open");
});
it("keeps every due destination, private reviews, and the active workout", async () => {
  show({ ...base, due: 3, duePaths: 2, mistakes: 2, retests: 1, vocabDue: 4, bookDue: 5, deckDue: 6,
    worksheetsDue: { count: 1, private: 2 },
    body: { routine: "Walk", exercises: 1, trained: false, openId: "workout-1", thisWeek: 2, hasPlan: true },
  });
  const table = await screen.findByRole("table", { name: /due today/i });
  expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
  const hrefs = within(table).getAllByRole("link").map((link) => link.getAttribute("href"));
  for (const to of ["/mastery", "/mastery/review", "/quiz/practice", "/loop", "/mastery/vocabulary", "/mastery/book-cards", "/mastery/decks", "/toolkit", "/body/workouts/workout-1"]) expect(hrefs).toContain(to);
  expect(within(table).getByText(/2 private/)).toBeInTheDocument();
});
it("puts the unfinished setup step first and marks completed steps", async () => {
  const { container } = show({ ...base, setup: { provider: true, documents: false, asked: false } });
  await screen.findByText("Welcome back, Learner.");
  const quickStart = container.querySelector(".lp-quick-start")!;
  expect(quickStart.querySelector('.lp-quick-start-action-primary')).toHaveAttribute("href", "/knowledge");
  expect(quickStart.querySelectorAll('li[data-done="true"]')).toHaveLength(1);
});
it("keeps the low-day minimum visible without exposing the full task", async () => {
  show({ ...base, lowDay: true, today: { id: "goal-1", goal: "Read news", next_task: "Read a full article", next_task_minimum: "Read a headline", still_worth_keeping: "Stay curious" } });
  expect(await screen.findByText("Read a headline")).toBeInTheDocument();
  expect(screen.queryByText("Read a full article")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Low day" })).toHaveAttribute("aria-pressed", "true");
});
it("describes every destination on More without untranslated keys", () => {
  const { container } = render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <More /> }])} />);
  for (const { page } of flatEntries()) {
    const link = container.querySelector(`a[href="${page.to}"]`)!;
    expect(link.nextSibling?.textContent).toContain(" · ");
    expect(link.parentElement?.querySelector("span")?.textContent).toMatch(/\.$/);
  }
  expect(container.textContent).not.toContain("home.up.");
});

it("provides every navigation description and entry prompt in all four locales", () => {
  for (const language of ["en", "vi", "es", "pt"]) {
    const { home: { up } } = JSON.parse(readFileSync(`public/locales/${language}/common.json`, "utf8"));
    for (const { page } of flatEntries()) {
      expect(up.descriptions[page.labelKey.split(".").pop()!], `${language}: ${page.to}`).toMatch(/.+\.$/);
    }
    for (const group of ["read", "ask", "practise", "reflect"]) {
      expect(up.entries[group].situation).toBeTruthy();
      expect(up.entries[group].keep).toBeTruthy();
    }
    expect(up.dueToday).toBeTruthy();
  }
});

it.each([
  { trained: true, lowDay: false, routine: "Walk", hasPlan: true, key: "trained" },
  { trained: false, lowDay: true, routine: "Walk", hasPlan: true, key: "lowDay" },
  { trained: false, lowDay: false, routine: null, hasPlan: true, key: "rest" },
  { trained: false, lowDay: false, routine: null, hasPlan: false, key: "noPlan" },
])("keeps the body status $key in the due table", async ({ lowDay, key, ...body }) => {
  const copy = JSON.parse(readFileSync("public/locales/en/body.json", "utf8"));
  show({ ...base, lowDay, body: { ...body, exercises: 1, openId: null, thisWeek: 2 } });
  const table = await screen.findByRole("table", { name: "Due today" });
  expect(within(table).getByText(copy.home[key])).toBeInTheDocument();
  expect(within(table).getByRole("link")).toHaveAttribute("href", "/body");
});
