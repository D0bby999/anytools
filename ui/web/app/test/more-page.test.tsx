/**
 * more-page.test.tsx
 * The phone's "More" page lists every study tool that has no rail item, and
 * each one is a registered route.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

const { default: More, TOOL_ITEMS } = await import("~/routes/more");

beforeAll(() => {
  initI18n("en");
});

describe("More", () => {
  it("lists every study tool, each a registered route", () => {
    const router = createMemoryRouter([{ path: "/", element: <More /> }], { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    const routes = readFileSync("app/routes.ts", "utf8");
    for (const { to } of TOOL_ITEMS) {
      expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === to), to).toBe(true);
      expect(routes, to).toContain(`"${to.slice(1).replace("settings/", "")}"`);
    }
  });
});
