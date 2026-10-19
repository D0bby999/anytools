/**
 * public-anylearn.test.tsx
 * `/{locale}/anylearn`, AnyLearn's page on the AnyTools site: complete in all
 * four languages, indexable with hreflang, in the sitemap, and the page tells
 * a visitor in another language that the app itself is in English.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://anytools.example", API_BASE: "", API_TOKEN: "" }));

import { publicLngs } from "~/lib/i18n";
import { anyLearnCopy } from "~/lib/tools/anylearn-page";
import { publicUrls } from "~/lib/tools/sitemap.server";

const page = await import("~/routes/public.anylearn");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (locale: string) => (page.loader as any)({ params: { locale }, request: new Request(`https://anytools.example/${locale}/anylearn`) });

describe("AnyLearn's page", () => {
  it("has every field in every language, and the same shape in each", () => {
    const en = anyLearnCopy("en");
    for (const l of publicLngs) {
      const c = anyLearnCopy(l);
      for (const [k, v] of Object.entries(c)) expect(v, `${l}.${k}`).not.toEqual("");
      expect(c.features).toHaveLength(en.features.length);
      expect(c.install.map((b) => b.steps.length)).toEqual(en.install.map((b) => b.steps.length));
      // The app is in English; only the other languages need to say so.
      expect(Boolean(c.englishNote)).toBe(l !== "en");
    }
  });

  it("answers 404 for a language the site does not have", async () => {
    await expect(load("fr")).rejects.toMatchObject({ status: 404 });
  });

  it("is indexable, with hreflang for the four languages", async () => {
    const data = await load("vi");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = page.meta({ data } as any) as Record<string, string>[];
    expect(tags.find((t) => t.title)?.title).toBe(anyLearnCopy("vi").metaTitle);
    expect(tags.find((t) => t.name === "robots")?.content ?? "index").not.toContain("noindex");
    const alternates = tags.filter((t) => t.rel === "alternate").map((t) => t.href);
    for (const l of publicLngs) expect(alternates).toContain(`https://anytools.example/${l}/anylearn`);
  });

  it("is in the sitemap in each language", () => {
    const urls = publicUrls();
    for (const l of publicLngs) expect(urls.some((u) => u.includes(`<loc>https://anytools.example/${l}/anylearn</loc>`))).toBe(true);
  });

  it("renders the Vietnamese page with its English note and the way in", async () => {
    const data = await load("vi");
    const Stub = createRoutesStub([{ path: "/:locale/anylearn", Component: page.default, loader: () => data }]);
    render(<Stub initialEntries={["/vi/anylearn"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "AnyLearn" })).toBeInTheDocument();
    expect(screen.getByText(/Giao diện AnyLearn hiện bằng tiếng Anh/)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: /Bắt đầu học/ })) expect(link).toHaveAttribute("href", "/login");
    expect(screen.getByRole("heading", { name: "iPhone và iPad" })).toBeInTheDocument();
  });
});
