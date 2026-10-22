/**
 * quick-setup.test.tsx
 * Setup in one step (the private design notes, phase 2): one
 * connection fills every empty task, the readiness table does not call an
 * optional task "Blocked", and a chain's dialog does not offer a connection
 * that cannot do the task.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { initI18n } from "~/lib/i18n";
import type { CatalogEntry, Connection, FunctionReadiness } from "~/lib/byok.types";

const calls: { path: string; method: string; body?: unknown }[] = [];
let routes: Record<string, unknown[]> = {};
let provider = "openai_compat";

vi.mock("~/lib/api.server", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
  apiFetch: vi.fn(async (path: string, _user: string, init?: { method?: string; body?: unknown }) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body });
    if (path === "/v1/byok/routes") {
      return {
        functions: ["chat", "parse", "embed", "quiz", "mastery", "reading", "solve", "research", "rerank", "tts", "stt"],
        routes,
        max_chain_entries: 5,
      };
    }
    if (path === "/v1/byok/connections") return { connections: [{ id: "c1", provider, kind: "api_key", name: "Ollama" }] };
    if (path === "/v1/byok/catalog") {
      return {
        providers: [
          { type: "openai_compat", serves: ["chat", "embed", "tts", "stt"], needs_model: true },
          { type: "anthropic", serves: ["chat", "parse"], needs_model: false },
        ],
      };
    }
    return undefined;
  }),
}));

const { quickSetup } = await import("~/lib/byok.server");
const { ReadinessMatrix } = await import("~/components/settings/readiness-matrix");
const { RouteChainDialog } = await import("~/components/settings/route-chain-dialog");

beforeAll(() => {
  initI18n("en");
});

beforeEach(() => {
  calls.length = 0;
  routes = {};
  provider = "openai_compat";
});

const puts = () => calls.filter((c) => c.method === "PUT").map((c) => c.path.replace("/v1/byok/routes/", ""));

describe("quick setup", () => {
  it("gives every empty task the connection, with its two models, and leaves speech and parse", async () => {
    routes = { quiz: [{ connection_id: "other", model: "m" }] };
    const result = await quickSetup("u", "c1", { chat: "gemma4:31b-cloud", embed: "nomic-embed-text" });
    expect(puts()).toEqual(["chat", "embed", "mastery", "reading", "solve", "research", "rerank"]);
    expect(result.left).toEqual(["parse", "tts", "stt"]);
    const embed = calls.find((c) => c.path.endsWith("/embed"));
    expect(embed?.body).toEqual({ entries: [{ connection_id: "c1", model: "nomic-embed-text" }] });
    const chat = calls.find((c) => c.path.endsWith("/chat"));
    expect(chat?.body).toEqual({ entries: [{ connection_id: "c1", model: "gemma4:31b-cloud" }] });
  });

  it("leaves indexing empty without an embeddings model on a provider that needs one", async () => {
    const result = await quickSetup("u", "c1", { chat: "llama3", embed: "" });
    expect(puts()).not.toContain("embed");
    expect(result.left).toContain("embed");
  });

  it("uses the provider's defaults where it has them, and never routes what it cannot do", async () => {
    provider = "anthropic";
    const result = await quickSetup("u", "c1", { chat: "", embed: "" });
    expect(puts()).toEqual(["chat", "parse", "quiz", "mastery", "reading", "solve", "research", "rerank"]);
    expect(result.left).toEqual(["embed", "tts", "stt"]);
  });
});

const row = (fn: string, over: Partial<FunctionReadiness> = {}): FunctionReadiness => ({
  function: fn,
  status: "blocked",
  reason: `No ${fn} route.`,
  reason_code: "no_route",
  entries: [],
  ...over,
});

describe("the readiness table", () => {
  it("calls an optional task left empty Not set, not Blocked, and points a missing one at its Edit", () => {
    render(
      <ReadinessMatrix
        functions={[row("tts"), row("quiz")]}
        optional={["parse", "tts", "stt"]}
        onRoutesPage
      />,
    );
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("Optional. AnyLearn works without it.")).toBeInTheDocument();
    expect(screen.getAllByText(/Blocked/)).toHaveLength(1);
    expect(screen.getByText(/Choose Edit on its row under Chains, below\./)).toBeInTheDocument();
  });

  it("says what a server reads without a parse model", () => {
    render(
      <ReadinessMatrix
        functions={[row("parse", { status: "warn", reason: "No model reads documents…", reason_code: "parse_local" })]}
        optional={["parse"]}
      />,
    );
    expect(screen.getByText(/scanned PDFs and photos need a model that reads images/)).toBeInTheDocument();
  });
});

describe("a chain's dialog", () => {
  it("lists a connection that cannot do the task without offering it", async () => {
    const connections = [
      { id: "a", provider: "anthropic", kind: "api_key", name: "Claude" },
      { id: "o", provider: "openai_compat", kind: "api_key", name: "Ollama" },
    ] as Connection[];
    const catalog = [
      { type: "anthropic", serves: ["chat", "parse"] },
      { type: "openai_compat", serves: ["chat", "embed"], needs_model: true },
    ] as CatalogEntry[];
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <RouteChainDialog fn="embed" entries={[]} connections={connections} catalog={catalog} maxEntries={5} />,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const claude = screen.getByRole("option", { name: "Claude (cannot do this)" });
    expect(claude).toBeDisabled();
    expect(screen.getByRole("option", { name: "Ollama" })).not.toBeDisabled();
  });
});
