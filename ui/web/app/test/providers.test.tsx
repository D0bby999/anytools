/**
 * The Providers page (plan 261021-1100 phase 4): the catalog's filters, the
 * grid that draws them, and models sorted into kinds.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { CatalogEntry } from "~/lib/byok.types";
import { filterProviders, groupModels, modelKind, NO_FILTER } from "~/lib/provider-catalog";
import { ProviderGrid } from "~/components/settings/provider-grid";

beforeAll(() => initI18n("en"));

const entry = (type: string, label: string, more: Partial<CatalogEntry> = {}): CatalogEntry => ({
  type,
  label,
  icon: label.slice(0, 2).toUpperCase(),
  auth: "api_key",
  hue: "read",
  serves: ["chat"],
  ...more,
});

const CATALOG: CatalogEntry[] = [
  entry("gemini", "Google Gemini", { free_tier: true, serves: ["chat", "parse", "embed", "stt"] }),
  entry("openai", "OpenAI", { serves: ["chat", "parse", "embed", "tts", "stt"] }),
  entry("cerebras", "Cerebras", { free_tier: true, needs_model: true }),
  entry("openai_compat", "Custom endpoint", { auth: "custom" }),
];

const none = () => 0;

describe("filterProviders", () => {
  it("searches names and ids without case or accents", () => {
    expect(filterProviders(CATALOG, { ...NO_FILTER, query: "GÉMINI" }, none).map((e) => e.type)).toEqual(["gemini"]);
    expect(filterProviders(CATALOG, { ...NO_FILTER, query: "compat" }, none).map((e) => e.type)).toEqual(["openai_compat"]);
  });

  it("narrows by access, by what a provider can do, and to the connected ones", () => {
    const types = (f: Partial<typeof NO_FILTER>, count: (type: string) => number = none) =>
      filterProviders(CATALOG, { ...NO_FILTER, ...f }, count).map((e) => e.type);
    expect(types({ access: "free" })).toEqual(["gemini", "cerebras"]);
    expect(types({ access: "custom" })).toEqual(["openai_compat"]);
    expect(types({ serves: "tts" })).toEqual(["openai"]);
    expect(types({ serves: "stt", access: "free" })).toEqual(["gemini"]);
    expect(types({ connected: true }, (t) => (t === "cerebras" ? 2 : 0))).toEqual(["cerebras"]);
  });
});

describe("model kinds", () => {
  it.each([
    ["gpt-4o-mini", "chat"],
    ["meta-llama/Llama-3.3-70B-Instruct", "chat"],
    ["text-embedding-3-small", "embed"],
    ["BAAI/bge-m3", "embed"],
    ["whisper-large-v3", "stt"],
    ["gpt-4o-mini-tts", "tts"],
    ["dall-e-3", "image"],
    ["black-forest-labs/FLUX.1-schnell", "image"],
    ["omni-moderation-latest", "other"],
  ])("%s is %s", (id, kind) => {
    expect(modelKind(id)).toBe(kind);
  });

  it("groups, sorts and drops repeats, chat first", () => {
    expect(groupModels(["whisper-1", "b-chat", "a-chat", "a-chat", "text-embedding-3-small"])).toEqual([
      { kind: "chat", models: ["a-chat", "b-chat"] },
      { kind: "embed", models: ["text-embedding-3-small"] },
      { kind: "stt", models: ["whisper-1"] },
    ]);
  });
});

describe("ProviderGrid", () => {
  function renderGrid(connected: Record<string, number> = {}) {
    const router = createMemoryRouter([{ path: "/", element: <ProviderGrid entries={CATALOG} connected={connected} /> }]);
    return render(<RouterProvider router={router} />);
  }

  it("lists every provider as a link to its page, with the count said", () => {
    renderGrid({ openai: 1 });
    expect(screen.getByRole("status")).toHaveTextContent("4 of 4 providers");
    expect(screen.getByRole("link", { name: "OpenAI" })).toHaveAttribute("href", "/settings/providers/openai");
    const card = screen.getByRole("link", { name: "OpenAI" }).closest("li")!;
    expect(within(card).getByText("1 connection")).toBeInTheDocument();
  });

  it("filters with toggle buttons that say which is on, and offers no empty access filter", async () => {
    renderGrid();
    // No sign-in provider in this catalog: no Sign-in chip.
    expect(screen.queryByRole("button", { name: "Sign-in" })).toBeNull();
    const free = screen.getByRole("button", { name: "Free tier" });
    await userEvent.click(free);
    expect(free).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 providers");
    await userEvent.click(screen.getByRole("button", { name: "Read documents" }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Google Gemini"]);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText(/No provider matches/)).toBeInTheDocument();
  });
});
