/**
 * home-focus.test.tsx
 * Phase 7 of the private design notes: a first visit is greeted as
 * one and asked what the learner wants to learn; Home then lists the parts
 * that serve it, never hiding what is due, with every part one click away.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ComponentProps } from "react";
import { initI18n } from "~/lib/i18n";
import { servesFocus } from "~/lib/study-focus";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api", API_TOKEN: "t", APP_URL: "http://app.test", SESSION_SECRET: "s".repeat(32), useSecureCookies: false }));
const { default: Home, STARTERS } = await import("~/routes/home");
type Data = ComponentProps<typeof Home>["loaderData"];

const base: Data = {
  setup: { provider: true, documents: true, asked: true },
  readiness: null, due: 0, duePaths: 0, vocabDue: 0, retests: 0, bookDue: 0,
  deckDue: 0, mistakes: 0, today: null, lowDay: false,
  worksheetsDue: { count: 0, private: 0 }, body: null, progress: null, cheers: [],
  focus: [], starters: [],
};

beforeAll(() => initI18n("en"));

function show(data: Data, url = "/home") {
  return render(
    <RouterProvider
      router={createMemoryRouter(
        [{ id: "routes/app-layout", path: "/home", loader: () => ({ displayName: "Lan" }), element: <Home loaderData={data} params={{}} matches={[] as never} /> }],
        { initialEntries: [url] },
      )}
    />,
  );
}

const progress = { streak: 0, weekDays: 0, weekGoal: 3, level: 1 };

describe("a first visit", () => {
  it("is greeted as one, and asked what to learn, with a language's first words", async () => {
    show({
      ...base,
      focus: null,
      progress: { ...progress, studiedBefore: false },
      starters: [{ lang: "ja", list: "jlpt", level: "jlpt-n5", name: "JLPT N5", count: 684 }],
    });
    await screen.findByText("Welcome, Lan.");
    const question = screen.getByRole("region", { name: "What do you want to learn?" });
    await userEvent.click(within(question).getByRole("checkbox", { name: /A language/ }));
    expect(within(question).getByLabelText("Which language?")).toHaveValue("es");
    // The interface's own language is not offered: an English interface is not learning English.
    expect(within(within(question).getByLabelText("Which language?")).queryByRole("option", { name: "English" })).toBeNull();
    await userEvent.selectOptions(within(question).getByLabelText("Which language?"), "ja");
    expect(within(question).getByRole("checkbox", { name: /20 a day from today \(JLPT N5, 684 words\)/ })).toBeChecked();
    expect(within(question).getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("says welcome back to someone who has studied, and asks nothing once answered", async () => {
    show({ ...base, progress: { ...progress, studiedBefore: true } });
    await screen.findByText("Welcome back, Lan.");
    expect(screen.queryByRole("region", { name: "What do you want to learn?" })).toBeNull();
  });
});

describe("a language's first words", () => {
  it("are the first list in it: NGSL 1–500 for English, not the academic list", () => {
    expect(STARTERS.find((s) => s.lang === "en")).toMatchObject({ list: "ngsl", level: "ngsl-1", count: 500 });
  });
});

describe("parts by focus", () => {
  it("leaves out the parts made for another purpose, and keeps the rest", () => {
    expect(servesFocus("/body/plan", ["languages"])).toBe(false);
    expect(servesFocus("/languages", ["languages"])).toBe(true);
    expect(servesFocus("/research", ["documents"])).toBe(false);
    expect(servesFocus("/chat", ["languages"])).toBe(true);
    expect(servesFocus("/body", [])).toBe(true);
    expect(servesFocus("/body", null)).toBe(true);
  });

  it("lists a language learner's parts, keeps Body's due row, and shows every part on request", async () => {
    const workout = { routine: "Walk", exercises: 1, trained: false, openId: "w1", thisWeek: 1, hasPlan: true };
    const { container, unmount } = show({ ...base, focus: ["languages"], body: workout });
    const due = await screen.findByRole("table", { name: "Due today" });
    expect(within(due).getAllByRole("link").map((a) => a.getAttribute("href"))).toContain("/body/workouts/w1");
    expect(container.querySelector('.lp-guide-path[href="/languages"]')).toBeTruthy();
    expect(container.querySelector('.lp-guide-path[href="/body/plan"]')).toBeNull();
    const all = screen.getByRole("link", { name: /Show every part/ });
    expect(all).toHaveAttribute("href", "/home?parts=all");
    unmount();

    const again = show({ ...base, focus: ["languages"] }, "/home?parts=all");
    await screen.findByRole("link", { name: "Show only the parts for what I learn" });
    expect(again.container.querySelector('.lp-guide-path[href="/body/plan"]')).toBeTruthy();
  });
});
