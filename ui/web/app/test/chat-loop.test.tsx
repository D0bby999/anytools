/**
 * chat-loop.test.tsx — what the chat loop's phase 5 (plan 261021-1100) shows:
 * the summary checkpoint, "Ask again with…", what the work record now says,
 * and cached tokens on the context meter.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { summaryParts } from "~/components/chat/summary-checkpoint";
import { ContextMeter } from "~/components/chat/composer/context-meter";
import { ProcessRow } from "~/components/chat/process-row";
import { readWork } from "~/lib/chat-work";

beforeAll(() => {
  initI18n("en");
});

function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

const question = (id: string, content: string): ChatTurnView => ({ id, role: "user", content, sources: [] });
const answer = (id: string, content: string): ChatTurnView => ({ id, role: "assistant", content, sources: [], capability: "chat" });
const turns = [question("q1", "First?"), answer("a1", "First answer"), question("q2", "Second?"), answer("a2", "Second answer")];

const SUMMARY = "Goal: pass biology\n**Covered:** osmosis\n- Open: none\nDocuments: Cell biology.pdf\n  and its notes";

describe("the summary checkpoint", () => {
  it("reads the four parts in order, continuation lines included", () => {
    expect(summaryParts(SUMMARY)).toEqual([
      { part: "goal", text: "pass biology" },
      { part: "covered", text: "osmosis" },
      { part: "open", text: "none" },
      { part: "documents", text: "Cell biology.pdf\nand its notes" },
    ]);
    expect(summaryParts("They studied membranes.")).toBeNull();
  });

  it("sits after the last message the summary covers and opens it with named parts", async () => {
    renderRouted(<MessageList turns={turns} checkpoint={{ afterId: "a1", summary: SUMMARY }} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2]).toHaveTextContent("Earlier messages summarised");
    const toggle = screen.getByRole("button", { name: "Show summary" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide summary" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Still open").nextSibling).toHaveTextContent("Nothing");
    expect(screen.getByText("Documents").nextSibling).toHaveTextContent("Cell biology.pdf");
  });

  it("is not drawn for a message that is not on the page", () => {
    renderRouted(<MessageList turns={turns} checkpoint={{ afterId: "gone", summary: SUMMARY }} />);
    expect(screen.queryByText("Earlier messages summarised")).toBeNull();
  });
});

describe("Ask again with…", () => {
  const models = [
    { id: "c1", name: "Groq", model: "llama-3.3" },
    { id: "c2", name: "Gemini", model: "gemini-2.5-flash" },
  ];

  it("asks the last question again with the model picked", async () => {
    const onRegenerateWith = vi.fn();
    renderRouted(<MessageList turns={turns} actions={{ onRegenerate: vi.fn(), askWith: models, onRegenerateWith }} />);
    const opener = screen.getByRole("button", { name: "Ask again with…" });
    await userEvent.click(opener);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: /Gemini/ }));
    expect(onRegenerateWith).toHaveBeenCalledWith("q2", models[1]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is not offered with a single model", () => {
    renderRouted(
      <MessageList turns={turns} actions={{ onRegenerate: vi.fn(), askWith: models.slice(0, 1), onRegenerateWith: vi.fn() }} />,
    );
    expect(screen.queryByRole("button", { name: "Ask again with…" })).toBeNull();
  });
});

describe("the work record", () => {
  const work = readWork({
    steps: [{ tool: "read_source", kept: "r1", flagged: true, ms: 5 }],
    rounds: 3,
    stopped: "loop",
    elided: 2,
    cached_tokens: 12_400,
  })!;

  it("reads what phase 5 added", () => {
    expect(work).toMatchObject({ stoppedLoop: true, elided: 2, cachedTokens: 12_400 });
    expect(work.steps[0]).toMatchObject({ kept: true, flagged: true });
  });

  it("says each of them under the answer", async () => {
    renderRouted(<ProcessRow turnId="t1" work={work} state="done" />);
    for (const toggle of screen.getAllByRole("button", { expanded: false })) await userEvent.click(toggle);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Stopped searching when the last rounds found nothing new");
    expect(text).toContain("Set 2 earlier results aside to make room");
    expect(text).toContain("12.4k tokens read from the provider's cache");
    expect(text).toContain("contained an instruction to the model, not followed");
    expect(text).toContain("kept to read by page");
  });
});

describe("the context meter", () => {
  it("says how much of the prompt came from the provider's cache", () => {
    render(<ContextMeter used={20_000} window={128_000} cached={15_000} />);
    expect(screen.getByRole("meter").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("The provider read about 15k of them from its cache."),
    );
  });
});
