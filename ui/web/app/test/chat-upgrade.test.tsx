/**
 * chat-upgrade.test.tsx — the chat surface after postclaw (plan 261019-1015):
 * the work row, follow-ups, asking again, editing, the queue, the draft.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { Composer } from "~/components/chat/composer";
import { WorkRow } from "~/components/chat/work-row";
import { Starters } from "~/components/chat/follow-ups";
import { withoutCitations } from "~/components/ui/copy-text";
import { liveWork, readFollowUps, readWork, workTotals } from "~/lib/chat-work";

beforeAll(() => {
  initI18n("en");
});

beforeEach(() => {
  window.localStorage.clear();
});

function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

const question = (id: string, content: string): ChatTurnView => ({ id, role: "user", content, sources: [] });
const answer = (id: string, content: string, extra: Partial<ChatTurnView> = {}): ChatTurnView => ({
  id,
  role: "assistant",
  content,
  sources: [],
  capability: "chat",
  ...extra,
});

describe("chat-work", () => {
  it("reads a stored work record and ignores what it does not know", () => {
    const work = readWork({
      steps: [{ tool: "rag_search", detail: "ty thể", found: 4, ms: 120 }, { nope: 1 }, { tool: "rag_search", repeated: true }],
      summarised: 6,
      limit_reached: true,
      context_tokens: 3200,
      context_window: 32768,
    });
    expect(work?.steps).toHaveLength(2);
    expect(work?.limitReached).toBe(true);
    expect(workTotals(work!)).toEqual({ searches: 1, passages: 4, steps: 1 });
    expect(readWork(null)).toBeNull();
  });

  it("keeps only follow-up kinds this client has words for", () => {
    expect(readFollowUps(["check", "made-up", "broaden", 3])).toEqual(["check", "broaden"]);
  });

  it("turns live tool frames into running steps", () => {
    const work = liveWork([{ callId: "1", name: "rag_search", status: "running", argument: "cells" }]);
    expect(work.steps[0]).toMatchObject({ tool: "rag_search", detail: "cells", running: true });
  });

  it("copies an answer without its citation markers", () => {
    expect(withoutCitations("ATP is made here [[cite:chunk:abc]]. Next.")).toBe("ATP is made here. Next.");
  });
});

describe("WorkRow", () => {
  it("folds a finished turn into one line and lists the steps inside", async () => {
    render(
      <WorkRow
        work={{
          steps: [
            { tool: "rag_search", detail: "ty thể", found: 3 },
            { tool: "rag_search", detail: "ribosome", found: 2 },
            { tool: "read_source", detail: "p. 2" },
          ],
          summarised: 4,
          ms: 4200,
        }}
      />,
    );
    expect(screen.getByText("Searched 2 times · 5 passages · 4.2 s")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Searched 2 times · 5 passages · 4.2 s"));
    expect(screen.getByText("“ribosome”")).toBeVisible();
    expect(screen.getByText("Summarised 4 earlier messages to fit the model")).toBeVisible();
  });

  it("names the step in progress while the turn runs", () => {
    render(<WorkRow live work={{ steps: [{ tool: "rag_search", running: true }] }} />);
    expect(screen.getAllByText("Searching your documents")[0]).toBeVisible();
  });

  it("renders nothing for a turn that did no work", () => {
    const { container } = render(<WorkRow work={{ steps: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MessageList at the end of a conversation", () => {
  const turns = [
    question("q1", "First?"),
    answer("a1", "First answer", { followUps: ["check"] }),
    question("q2", "Second?"),
    answer("a2", "Second answer", { followUps: ["check", "simpler"] }),
  ];

  it("offers Edit on the last question and Ask again on the last answer only", async () => {
    const onRegenerate = vi.fn();
    renderRouted(<MessageList turns={turns} actions={{ onRegenerate, onEdit: vi.fn(), onFollowUp: vi.fn() }} />);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    const again = screen.getAllByRole("button", { name: "Ask again" });
    expect(again).toHaveLength(1);
    await userEvent.click(again[0]!);
    expect(onRegenerate).toHaveBeenCalledWith("q2");
  });

  it("edits the last question and asks the new text", async () => {
    const onEdit = vi.fn();
    renderRouted(<MessageList turns={turns} actions={{ onEdit }} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit your question");
    await userEvent.clear(box);
    await userEvent.type(box, "Second, better?");
    await userEvent.click(screen.getByRole("button", { name: "Ask this instead" }));
    expect(onEdit).toHaveBeenCalledWith("q2", "Second, better?");
  });

  it("shows follow-ups under the last answer only, and sends their words", async () => {
    const onFollowUp = vi.fn();
    renderRouted(<MessageList turns={turns} actions={{ onFollowUp }} />);
    expect(screen.getAllByRole("button", { name: "Check I understood" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Explain it more simply" }));
    expect(onFollowUp).toHaveBeenCalledWith("Explain that more simply, as if I were new to the subject.");
  });

  it("offers nothing that starts a turn while one is running", () => {
    renderRouted(<MessageList turns={turns} actions={{ busy: true, onRegenerate: vi.fn(), onEdit: vi.fn(), onFollowUp: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check I understood" })).toBeNull();
  });

  it("does not offer to rewind to a question the server has not stored yet", () => {
    renderRouted(
      <MessageList turns={[question("live-user", "Pending?"), answer("live-t", "…")]} actions={{ onRegenerate: vi.fn(), onEdit: vi.fn() }} />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask again" })).toBeNull();
  });

  it("marks an answer that stopped before it finished", () => {
    renderRouted(<MessageList turns={[question("q", "Q"), answer("a", "Half", { incomplete: true })]} />);
    expect(screen.getByText("This answer stopped before it finished.")).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("queues a message typed while a turn runs instead of sending it", async () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    render(<Composer onSend={onSend} onStop={vi.fn()} busy onQueue={onQueue} />);
    await userEvent.type(screen.getByLabelText("Your message"), "next one{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).toHaveBeenCalledWith("next one");
  });

  it("stops the running turn on Esc", async () => {
    const onStop = vi.fn();
    render(<Composer onSend={vi.fn()} onStop={onStop} busy />);
    await userEvent.type(screen.getByLabelText("Your message"), "{Escape}");
    expect(onStop).toHaveBeenCalled();
  });

  it("lists queued messages and removes one", async () => {
    const onUnqueue = vi.fn();
    render(<Composer onSend={vi.fn()} busy queued={["a", "b"]} onQueue={vi.fn()} onUnqueue={onUnqueue} />);
    expect(screen.getByText("2 messages waiting to send")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: 'Remove "b" from the queue' }));
    expect(onUnqueue).toHaveBeenCalledWith(1);
  });

  it("keeps the draft per conversation and clears it on send", async () => {
    const onSend = vi.fn();
    const { unmount } = render(<Composer onSend={onSend} busy={false} draftKey="draft-1" />);
    await userEvent.type(screen.getByLabelText("Your message"), "half a question");
    expect(window.localStorage.getItem("draft-1")).toBe("half a question");
    unmount();

    render(<Composer onSend={onSend} busy={false} draftKey="draft-1" />);
    const box = screen.getByLabelText("Your message");
    expect(box).toHaveValue("half a question");
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("half a question");
    expect(window.localStorage.getItem("draft-1")).toBeNull();
  });

  it("pins a connection from the model menu", async () => {
    const onModel = vi.fn();
    render(
      <Composer
        onSend={vi.fn()}
        busy={false}
        models={[
          { id: "a", name: "OpenAI", model: "gpt-4o" },
          { id: "b", name: "Ollama", model: "qwen" },
        ]}
        model=""
        onModel={onModel}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Model"), "b::qwen");
    expect(onModel).toHaveBeenCalledWith("b::qwen");
  });
});

describe("Starters", () => {
  it("offers ways to begin named after the one knowledge base", async () => {
    const onPick = vi.fn();
    render(<Starters kbNames={["Cell biology"]} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "What is Cell biology about?" }));
    expect(onPick).toHaveBeenCalledWith("What is Cell biology about?");
  });

  it("offers nothing without a knowledge base", () => {
    const { container } = render(<Starters kbNames={[]} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
