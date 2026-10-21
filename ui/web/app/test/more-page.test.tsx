/**
 * more-page.test.tsx
 * The "All sections" page lists every page of the table of contents
 * (lib/nav-tree.ts), group by group, and each link resolves.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { flatEntries, NAV_TREE } from "~/lib/nav-tree";

const { default: More } = await import("~/routes/more");

beforeAll(() => {
  initI18n("en");
});

describe("More", () => {
  it("lists every page of the tree under its group's heading", () => {
    const router = createMemoryRouter([{ path: "/", element: <More /> }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: "All sections" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(NAV_TREE.length);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const { page } of flatEntries()) expect(hrefs, page.to).toContain(page.to);
    // The study tools that used to be listed by hand are all still here.
    for (const to of ["/quiz/practice", "/quiz/exams", "/mastery/vocabulary", "/mastery/book-cards", "/settings/profile", "/toolkit"]) {
      expect(hrefs, to).toContain(to);
    }
  });
});
