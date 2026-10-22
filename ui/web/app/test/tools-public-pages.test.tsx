/**
 * tools-public-pages.test.tsx
 * AnyTools phase 2, rendered: the article renderer runs nothing from the
 * content, the language switcher keeps the page, the catalog filters, the
 * header search gives way to a page's own, and the app's Tools tab is there.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://anytools.example", API_BASE: "", API_TOKEN: "" }));

import { Article } from "~/components/tools-site/article";
import { LocaleSwitcher } from "~/components/tools-site/locale-switcher";
import { PublicShell } from "~/components/tools-site/public-shell";
import { ToolCatalog } from "~/components/tools-site/tool-catalog";
import { Sidebar, TOOLS_ITEM } from "~/components/layout/sidebar";
import { TopNav } from "~/components/layout/top-nav";
import { initI18n, publicLngs } from "~/lib/i18n";
import { catalogEntries } from "~/lib/tools/catalog";
import { toolsI18n, type ToolsMessages } from "~/lib/tools/i18n";
import viTools from "../../public/locales/vi/tools.json";

const PublicLayout = (await import("~/routes/public.layout")).default;
const layoutLoader = (await import("~/routes/public.layout")).loader;
const tool = await import("~/routes/public.tool");
const home = await import("~/routes/public.home");

beforeAll(() => {
  initI18n("en");
});

const withTools = (locale: "en" | "vi", ui: React.ReactNode) => (
  <I18nextProvider i18n={toolsI18n(locale, locale === "en" ? null : (viTools as ToolsMessages))}>{ui}</I18nextProvider>
);

describe("an article", () => {
  it("renders Markdown, and none of the HTML or script it contains", () => {
    const { container } = render(
      <Article
        source={[
          "## How it works",
          "",
          "Text with <script>window.pwned = 1</script> and <img src=x onerror=alert(1)>.",
          "",
          "[bad](javascript:alert(1)) [good](https://example.com/a) [inside](/vi/web3/wallet-checker)",
          "",
          "![tracker](https://example.com/p.png)",
          "",
          "| a | b |",
          "|---|---|",
          "| 1 | 2 |",
        ].join("\n")}
      />,
    );
    expect(container.querySelector("script, img, iframe")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    // Steps down under the section's own h2.
    expect(container.querySelector("h3")).toHaveTextContent("How it works");
    expect(container.querySelector("h2")).toBeNull();
    expect(screen.getByText("bad").getAttribute("href") ?? "").not.toMatch(/javascript/i);
    const good = screen.getByText("good");
    expect(good).toHaveAttribute("target", "_blank");
    expect(good.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("inside")).not.toHaveAttribute("target");
    expect(container.querySelector("table td")).toHaveTextContent("1");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
});

function routed(path: string, element: React.ReactNode, data?: unknown) {
  const router = createMemoryRouter(
    [{ path: "/:locale/*", element, loader: () => data ?? null }],
    { initialEntries: [path], hydrationData: { loaderData: { "0": data ?? null } } },
  );
  return render(<RouterProvider router={router} />);
}

describe("the language switcher", () => {
  it("links the same page and query in each language, marking the current one", () => {
    routed("/vi/time-date/cron-parser?x=1", withTools("vi", <LocaleSwitcher locale="vi" />));
    const nav = screen.getByRole("navigation", { name: "Ngôn ngữ" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/en/time-date/cron-parser?x=1",
      "/vi/time-date/cron-parser?x=1",
      "/es/time-date/cron-parser?x=1",
      "/pt/time-date/cron-parser?x=1",
    ]);
    expect(within(nav).getByRole("link", { current: true })).toHaveAttribute("hreflang", "vi");
    expect(links[1]).toHaveAccessibleName("Tiếng Việt");
  });

  it("offers only the languages a page exists in, and no menu when only one is left", () => {
    routed("/en/lifestyle/gpa-calculator", withTools("en", <LocaleSwitcher locale="en" />), { locales: ["en", "vi"] });
    expect(within(screen.getByRole("navigation", { name: "Language" })).getAllByRole("link")).toHaveLength(2);
    cleanup();
    routed("/en/lifestyle/gpa-calculator", withTools("en", <LocaleSwitcher locale="en" />), { locales: ["en"] });
    expect(screen.queryByRole("navigation", { name: "Language" })).toBeNull();
  });
});

describe("the public shell", () => {
  it("has a header search that goes to the tools home, focused by / and Ctrl+K", async () => {
    routed("/es/web3", withTools("en", <PublicShell locale="es">page</PublicShell>));
    const box = screen.getByRole("searchbox", { name: "Search tools" });
    expect(box.closest("form")).toHaveAttribute("action", "/es/tools");
    fireEvent.keyDown(window, { key: "/" });
    expect(box).toHaveFocus();
    box.blur();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(box).toHaveFocus();
  });

  it("leaves the header search out on a page with its own", () => {
    const router = createMemoryRouter(
      [{ path: "/:locale", handle: { ownSearch: true }, element: withTools("en", <PublicShell locale="en">x</PublicShell>) }],
      { initialEntries: ["/en"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("the catalog", () => {
  it("filters by text and by cluster, and says how many it shows", async () => {
    const entries = catalogEntries("en");
    routed(
      "/en",
      withTools(
        "en",
        <ToolCatalog
          locale="en"
          entries={entries}
          clusters={[{ id: "web3", count: 3 }]}
          initial={{ query: "", cluster: "all", sort: "popular" }}
        />,
      ),
    );
    expect(screen.getByText("Showing 131 of 131 tools")).toBeInTheDocument();
    // cron-parser lists "crontab" among its keywords; the search reads those too.
    await userEvent.type(screen.getByRole("searchbox"), "crontab");
    await waitFor(() => expect(screen.getByText("Showing 2 of 131 tools")).toBeInTheDocument());
    // Shareable, without a navigation per keystroke.
    expect(window.location.search).toBe("?q=crontab");
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.click(screen.getByRole("button", { name: /Web3/ }));
    await waitFor(() => expect(screen.getByText("Showing 3 of 131 tools")).toBeInTheDocument());
    expect(window.location.search).toBe("?cluster=web3");
    expect(screen.getByRole("link", { name: /Wallet Address Checker/ })).toHaveAttribute("href", "/en/web3/wallet-checker");
  });
});

describe("a whole tool page", () => {
  it("renders the tool, its article, its FAQ and its siblings inside the shell", async () => {
    const Stub = createRoutesStub([
      {
        id: "routes/public.layout",
        path: "/:locale",
        Component: PublicLayout,
        loader: ({ params }) => layoutLoader({ params } as never),
        children: [
          {
            path: ":cluster/:tool",
            Component: tool.default,
            loader: ({ params }) => tool.loader({ params } as never),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/vi/time-date/timezone-converter"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Chuyển đổi Timezone" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Câu hỏi thường gặp" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cách hoạt động" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Đường dẫn" })).toHaveTextContent("AnyTools/Thời gian/Chuyển đổi Timezone");
    await waitFor(() => expect(screen.queryByText("Đang tải công cụ…")).toBeNull(), { timeout: 15_000 });
    expect(screen.getByRole("heading", { name: "Thêm công cụ Thời gian" })).toBeInTheDocument();
  });

  it("the tools home lists every tool as a link", async () => {
    const Stub = createRoutesStub([
      {
        id: "routes/public.layout",
        path: "/:locale",
        Component: PublicLayout,
        loader: ({ params }) => layoutLoader({ params } as never),
        children: [
          {
            index: true,
            Component: home.default,
            handle: home.handle,
            loader: ({ params, request }) => home.loader({ params, request } as never),
          },
        ],
      },
    ]);
    render(<Stub initialEntries={["/pt"]} />);
    await screen.findByRole("heading", { level: 1 });
    const toolLinks = screen.getAllByRole("link").filter((a) => /^\/pt\/[^/]+\/[^/]+$/.test(a.getAttribute("href") ?? ""));
    expect(toolLinks).toHaveLength(126);
    // One search on the page: the catalog's.
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
  });
});

describe("the app's AnyTools link", () => {
  it("is in the top nav and goes to /tools; the sidebar keeps it in the folded appendix", () => {
    const router = createMemoryRouter(
      [{ path: "/home", element: (<><TopNav displayName="A" email="a@example.com" /><Sidebar /></>) }],
      { initialEntries: ["/home"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("link", { name: "AnyTools" })).toHaveAttribute("href", "/tools");
    expect(screen.queryByRole("link", { name: /all free tools|^tools$/i })).toBeNull();
    expect(TOOLS_ITEM.to).toBe("/tools");
  });

  // Owner, 2026-10-21: Settings is one row pinned at the sidebar's foot that
  // opens the Settings page; Mine and the appendix come after Part IV.
  it("pins Settings at the sidebar's foot as one row to its page", () => {
    const router = createMemoryRouter([{ path: "/home", element: <Sidebar /> }], { initialEntries: ["/home"] });
    render(<RouterProvider router={router} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    // Part IV's heading is its numeral tab (decorative) and "Part IV: Reflect".
    const reflect = headings.findIndex((h) => h?.endsWith("Part IV: Reflect"));
    expect(reflect).toBeGreaterThan(-1);
    expect(headings.indexOf("Mine")).toBe(reflect + 1);
    expect(headings.indexOf("Appendix")).toBe(reflect + 2);
    const links = screen.getAllByRole("link");
    expect(links.at(-1)).toHaveAccessibleName("Settings");
    expect(links.at(-1)).toHaveAttribute("href", "/settings");
  });
});

describe("the tools locale files", () => {
  const read = (l: string) => JSON.parse(readFileSync(resolve(process.cwd(), `public/locales/${l}/tools.json`), "utf8"));
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
      : [prefix];
  // Plural forms differ by language (Vietnamese has only `other`).
  const base = (k: string) => k.replace(/_(one|other|few|many)$/, "");

  it("vi, es and pt carry every English key, with the same placeholders", () => {
    const en = read("en");
    const enKeys = [...new Set(keys(en).map(base))].sort();
    for (const l of publicLngs.filter((x) => x !== "en")) {
      const other = read(l);
      expect([...new Set(keys(other).map(base))].sort(), l).toEqual(enKeys);
      for (const k of keys(en)) {
        const get = (o: unknown) =>
          k.split(".").reduce<unknown>((acc, p) => (acc as Record<string, unknown> | undefined)?.[p], o);
        const enValue = get(en);
        const value = get(other) ?? get(other) ?? undefined;
        if (typeof enValue !== "string" || typeof value !== "string") continue;
        const slots = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
        expect(slots(value), `${l}:${k}`).toEqual(slots(enValue));
      }
    }
  });
});

/**
 * The old AnyTools class vocabulary has no meaning here, and some of it means
 * something else: `accent` is reading progress only (DESIGN.md). A ported
 * tool that keeps it renders unstyled or terracotta, silently.
 */
describe("ported tools speak this app's tokens", () => {
  const APP = resolve(process.cwd(), "app");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });
  const files = [...walk(join(APP, "tools")), ...walk(join(APP, "components/tools-ui")), ...walk(join(APP, "components/tools-site"))];
  const OLD =
    /\b(?:bg|text|border|ring|fill|stroke|outline|accent|from|to)-(?:accent|secondary|popover|success|input|ring|card-foreground)\b|\bring-ring\b|\btext-\[\d+px\]|\bborder-l-\d/;

  it("finds the ported files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map((p) => [relative(APP, p), p] as const))("%s", (_name, path) => {
    const offenders = readFileSync(path, "utf8")
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line) && OLD.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
