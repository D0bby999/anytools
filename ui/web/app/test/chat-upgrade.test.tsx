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
import { ProcessRow } from "~/components/chat/process-row";
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

describe("ProcessRow", () => {
  const work = {
    steps: [
      { tool: "rag_search", detail: "ty thể", found: 3 },
      { tool: "rag_search", detail: "ribosome", found: 2 },
      { tool: "read_source", detail: "p. 2" },
    ],
    summarised: 4,
    ms: 4200,
  };

  it("folds a completed answer's work behind one row, grouped by kind inside", async () => {
    render(<ProcessRow turnId="a1" work={work} state="done" />);
    const turn = screen.getByRole("button", { name: "Searched, Read sources · 5 passages · 4.2 s" });
    expect(turn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(turn);
    expect(turn).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("button", { name: "Searched (2)" });
    expect(screen.getByRole("button", { name: "Read sources" })).toBeVisible();
    expect(screen.getByText("Summarised 4 earlier messages to fit the model")).toBeVisible();
    await userEvent.click(group);
    expect(screen.getByText("“ribosome”")).toBeVisible();
  });

  it("keeps folded steps in the page, hidden until found", () => {
    const { container } = render(<ProcessRow turnId="a1" work={work} state="done" />);
    expect(screen.getByText("“ribosome”", { selector: "span" })).toBeInTheDocument();
    expect(container.querySelector('[data-fold-key="a1"]')).toHaveAttribute("hidden", "until-found");
  });

  it("shows the groups open while running, naming the live step and its argument", () => {
    render(<ProcessRow turnId="live" state="running" work={{ steps: [{ tool: "rag_search", detail: "Ohm's law", running: true }] }} />);
    expect(screen.queryByTestId("process-turn")).toBeNull();
    expect(screen.getByRole("button", { name: "Searching · Ohm's law" })).toBeInTheDocument();
  });

  it("keeps a stopped answer's work open, with a failed group marked", () => {
    render(<ProcessRow turnId="a2" state="interrupted" work={{ steps: [{ tool: "web_search", error: true }] }} />);
    expect(screen.queryByTestId("process-turn")).toBeNull();
    expect(screen.getByRole("button", { name: "Searched" })).toHaveClass("text-destructive");
  });

  it("shows live reasoning as its own group", () => {
    render(<ProcessRow turnId="live" state="running" thinking="Let me check the page." work={{ steps: [] }} />);
    expect(screen.getByRole("button", { name: "Thinking" })).toBeInTheDocument();
  });

  it("renders nothing for a turn that did no work", () => {
    const { container } = render(<ProcessRow turnId="a3" state="done" work={{ steps: [] }} />);
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
  const docs = [
    { id: "d1", title: "Tế bào.pdf" },
    { id: "d2", title: "Ty thể notes" },
  ];

  it("queues a message typed while a turn runs instead of sending it", async () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    renderRouted(<Composer onSend={onSend} onStop={vi.fn()} busy onQueue={onQueue} />);
    await userEvent.type(screen.getByLabelText("Your message"), "next one{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).toHaveBeenCalledWith("next one");
  });

  it("lists queued messages in the dock, removes one, and resumes a paused queue", async () => {
    const onUnqueue = vi.fn();
    const onResume = vi.fn();
    renderRouted(
      <Composer onSend={vi.fn()} busy queued={["a", "b"]} onQueue={vi.fn()} onUnqueue={onUnqueue} queuePaused="failed" onResume={onResume} />,
    );
    expect(screen.getByText("The answer failed. 2 queued messages are waiting.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: 'Remove "b" from the queue' }));
    expect(onUnqueue).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole("button", { name: "Send next" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("keeps the draft per conversation and clears it on send", async () => {
    const onSend = vi.fn();
    const first = renderRouted(<Composer onSend={onSend} busy={false} draftKey="draft-1" />);
    await userEvent.type(screen.getByLabelText("Your message"), "half a question");
    expect(window.localStorage.getItem("draft-1")).toBe("half a question");
    first.unmount();

    renderRouted(<Composer onSend={onSend} busy={false} draftKey="draft-1" />);
    const box = screen.getByLabelText("Your message");
    expect(box).toHaveValue("half a question");
    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("half a question", undefined, {});
    expect(window.localStorage.getItem("draft-1")).toBeNull();
  });

  it("pins a connection from the model chip, naming each by the learner's name and its model", async () => {
    const onModel = vi.fn();
    renderRouted(
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
    const chip = screen.getByRole("button", { name: "Model: OpenAI, gpt-4o" });
    await userEvent.click(chip);
    expect(screen.getByRole("menuitemradio", { name: /OpenAI.*gpt-4o.*Default/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Ollama.*qwen/ }));
    expect(onModel).toHaveBeenCalledWith("b::qwen");
  });

  it("shows a pending switch as busy and a refused one as such", () => {
    const models = [
      { id: "a", name: "OpenAI", model: "gpt-4o" },
      { id: "b", name: "Ollama", model: "qwen" },
    ];
    const { rerender } = renderRouted(<Composer onSend={vi.fn()} busy={false} models={models} model="" onModel={vi.fn()} modelPending />);
    expect(screen.getByRole("button", { name: "Model: OpenAI, gpt-4o" })).toHaveAttribute("aria-busy", "true");
    rerender(
      <RouterProvider
        router={createMemoryRouter([{ path: "/", element: <Composer onSend={vi.fn()} busy={false} models={models} model="" onModel={vi.fn()} modelFailed /> }])}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't switch model");
  });

  it("offers the commands after a leading /, by keyboard", async () => {
    renderRouted(<Composer onSend={vi.fn()} busy={false} />);
    const box = screen.getByLabelText("Your message");
    await userEvent.type(box, "/su");
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["/summariseSummarise · a few short points"]);
    await userEvent.keyboard("{Enter}");
    expect(box).toHaveValue("/summarise ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the menu on Escape without anything else", async () => {
    renderRouted(<Composer onSend={vi.fn()} busy={false} />);
    const box = screen.getByLabelText("Your message");
    await userEvent.type(box, "/");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("/");
  });

  it("points at a document with @, without diacritics, and sends it as a reference", async () => {
    const onSend = vi.fn();
    renderRouted(<Composer onSend={onSend} busy={false} documents={docs} />);
    const box = screen.getByLabelText("Your message");
    await userEvent.type(box, "Explain @te ba");
    expect(screen.queryByRole("listbox")).toBeNull(); // a space ends the mention
    await userEvent.clear(box);
    await userEvent.type(box, "Explain @te");
    // A word starting with "te" (Tế) before a title that only contains it (notes).
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Tế bào.pdf", "Ty thể notes"]);
    await userEvent.keyboard("{Enter}");
    expect(box).toHaveValue("Explain ");
    expect(screen.getByRole("list", { name: "Attached" })).toHaveTextContent("Tế bào.pdf");
    await userEvent.type(box, "this{Enter}");
    expect(onSend).toHaveBeenCalledWith("Explain this", undefined, { references: [docs[0]] });
  });

  it("sends a photo with the question, and a photo alone", async () => {
    const onSend = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    const { container } = renderRouted(<Composer onSend={onSend} busy={false} />);
    const photo = new File(["x"], "problem.png", { type: "image/png" });
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, photo);
    expect(await screen.findByText("Photo for Solve: problem.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("", undefined, { photo });
  });

  it("refuses a file when the conversation reads no knowledge base", async () => {
    const { container } = renderRouted(<Composer onSend={vi.fn()} busy={false} />);
    await userEvent.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/notes.pdf was not added. Choose a knowledge base/)).toBeInTheDocument();
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
