/**
 * chat-components.test.tsx
 *
 * The rendering half of AC1: a citation is a LINK to the page the passage came
 * from. A chip that displayed a title and opened nothing would satisfy every
 * other test in this phase and defeat the product's entire claim.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { CitationChip } from "~/components/chat/citation-chip";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { WaitForInputCard } from "~/components/chat/wait-for-input-card";
import { ToolActivityPanel } from "~/components/chat/tool-activity";
import { ContextBar } from "~/components/chat/context-bar";
import { Composer } from "~/components/chat/composer";

beforeAll(() => {
  initI18n("en");
});

/** Renders inside a router, because chips are <Link>s. */
function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] });
  return render(<RouterProvider router={router} />);
}

describe("CitationChip", () => {
  it("links to the document AT THE PAGE the passage came from", () => {
    renderRouted(
      <CitationChip
        index={1}
        source={{ kind: "chunk", id: "c1", title: "Chapter 3", page: 14, document_id: "doc-1" }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/documents/doc-1?page=14");
    expect(link).toHaveAccessibleName("Open Chapter 3, page 14");
  });

  it("omits the page parameter when the source is not page-addressable", () => {
    renderRouted(
      <CitationChip index={1} source={{ kind: "chunk", id: "c1", title: "Notes", document_id: "doc-2" }} />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/documents/doc-2");
  });

  it("names the sheet of a spreadsheet passage beside its page", () => {
    renderRouted(
      <CitationChip
        index={2}
        source={{ kind: "chunk", id: "c2", title: "Plan.xlsx", page: 2, document_id: "doc-3", sheet: "Budget" }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/documents/doc-3?page=2");
    expect(link).toHaveTextContent("Sheet: Budget, p. 2");
    expect(link).toHaveAccessibleName("Open Plan.xlsx, Sheet: Budget, p. 2");
    expect(link).not.toHaveTextContent("p.2");
  });

  it("renders a source with no document as text, never as a dead link", () => {
    renderRouted(<CitationChip index={1} source={{ kind: "chunk", id: "c1", title: "Orphan" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
  });
});

describe("MessageList", () => {
  const turn: ChatTurnView = {
    id: "t1",
    role: "assistant",
    content: "It merges two arms [[cite:chunk:c1]] with RRF.",
    sources: [{ kind: "chunk", id: "c1", title: "Chapter 3", page: 14, document_id: "doc-1" }],
  };

  it("renders a citation marker as a chip, inline, where the claim was made", () => {
    renderRouted(<MessageList turns={[turn]} />);

    // The raw marker never reaches the screen.
    expect(screen.queryByText(/\[\[cite:/)).toBeNull();

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/documents/doc-1?page=14");
    // And the prose around it survived the split.
    expect(screen.getByText(/It merges two arms/)).toBeInTheDocument();
    expect(screen.getByText(/with RRF\./)).toBeInTheDocument();
  });

  /**
   * The server drops unsupported citations before an answer is stored, so this
   * should be unreachable — but a marker rendered as literal text would be the
   * appearance of evidence, which is the one failure mode worth a second guard.
   */
  it("drops a marker whose source the turn never produced", () => {
    renderRouted(
      <MessageList
        turns={[{ ...turn, content: "Invented [[cite:chunk:nope]].", sources: [] }]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(/\[\[cite:/)).toBeNull();
  });

  it("shows the empty state before anything has been asked", () => {
    renderRouted(<MessageList turns={[]} />);
    expect(screen.getByText(/Ask a question to begin/)).toBeInTheDocument();
  });
});

describe("WaitForInputCard", () => {
  it("labels the input with the question and offers the options as buttons", async () => {
    const onAnswer = vi.fn();
    render(
      <WaitForInputCard
        question={{ id: "q-1", question: "Which chapter did you mean?", options: ["Chapter 3", "Chapter 4"] }}
        onAnswer={onAnswer}
      />,
    );

    // The question IS the field's label, so a screen reader announces the two
    // together instead of leaving the input unexplained.
    expect(screen.getByLabelText("Which chapter did you mean?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Chapter 4" }));
    expect(onAnswer).toHaveBeenCalledWith("Chapter 4");
  });

  it("always accepts a typed answer, because the options are suggestions", async () => {
    const onAnswer = vi.fn();
    render(
      <WaitForInputCard
        question={{ id: "q-1", question: "Which chapter?", options: ["3", "4"] }}
        onAnswer={onAnswer}
      />,
    );

    await userEvent.type(screen.getByLabelText("Which chapter?"), "the appendix");
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(onAnswer).toHaveBeenCalledWith("the appendix");
  });

  it("refuses an empty answer", () => {
    render(
      <WaitForInputCard question={{ id: "q-1", question: "Which chapter?", options: [] }} onAnswer={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Answer" })).toBeDisabled();
  });
});

describe("ToolActivityPanel", () => {
  it("lists sources as chips and tool rounds with a non-colour status", () => {
    renderRouted(
      <ToolActivityPanel
        sources={[{ kind: "chunk", id: "c1", title: "Chapter 3", page: 14, document_id: "doc-1" }]}
        tools={[
          { callId: "a", name: "rag_search", status: "done", detail: "3 passages" },
          { callId: "b", name: "read_source", status: "error", detail: "refused" },
        ]}
        thinking=""
        stage={null}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "/documents/doc-1?page=14");
    // Colour alone never carries meaning: each row states its status in text
    // for a screen reader.
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("keeps reasoning collapsed until it is asked for", async () => {
    renderRouted(
      <ToolActivityPanel sources={[]} tools={[]} thinking="deciding which KB to search" stage={null} />,
    );

    expect(screen.queryByText("deciding which KB to search")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show reasoning" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(screen.getByText("deciding which KB to search")).toBeInTheDocument();
  });

  it("renders nothing at all when the turn has produced nothing", () => {
    const { container } = renderRouted(
      <ToolActivityPanel sources={[]} tools={[]} thinking="" stage={null} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("ContextBar", () => {
  const kbs = [
    { id: "a", name: "Retrieval papers" },
    { id: "b", name: "Cell biology" },
  ];

  it("names what the conversation reads, on the bar itself", () => {
    renderRouted(<ContextBar title="Retrieval" kbs={kbs} attached={["a", "b"]} allowWeb={false} />);
    expect(screen.getByRole("heading", { name: "Retrieval" })).toBeInTheDocument();
    expect(screen.getByText("Retrieval papers, Cell biology")).toBeInTheDocument();
  });

  it("offers to attach documents when nothing is attached", () => {
    renderRouted(<ContextBar title="" kbs={kbs} attached={[]} allowWeb={false} />);
    expect(screen.getByText("Attach documents")).toBeInTheDocument();
    // Every knowledge base is a choice, none ticked.
    const boxes = screen.getAllByRole("checkbox", { hidden: true });
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
  });

  /**
   * The allow-web switch stays hidden until phase 9 mounts a network tool. A
   * toggle that controls nothing teaches people that toggles here do not
   * matter.
   */
  it("hides the allow-web toggle until a network tool exists", () => {
    renderRouted(<ContextBar title="x" kbs={kbs} attached={["a"]} allowWeb={false} onToggleWeb={vi.fn()} />);
    expect(screen.queryByLabelText("Allow web in this session")).toBeNull();

    renderRouted(
      <ContextBar title="x" kbs={kbs} attached={["a"]} allowWeb={false} onToggleWeb={vi.fn()} showWebToggle />,
    );
    expect(screen.getByLabelText("Allow web in this session")).toBeInTheDocument();
  });
});

describe("Composer", () => {
  it("sends on Enter and clears, but not on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} />);

    const box = screen.getByLabelText("Your message");
    await userEvent.type(box, "first line{Shift>}{Enter}{/Shift}second line");
    expect(onSend).not.toHaveBeenCalled();

    await userEvent.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("first line\nsecond line");
    expect(box).toHaveValue("");
  });

  it("refuses whitespace", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} />);

    await userEvent.type(screen.getByLabelText("Your message"), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("offers Stop instead of Send while a turn is running", async () => {
    const onStop = vi.fn();
    render(<Composer onSend={vi.fn()} onStop={onStop} busy />);

    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("names the model choice only when there is one to make", () => {
    const { rerender } = render(<Composer onSend={vi.fn()} busy={false} models={[{ id: "a", name: "Key", model: "m" }]} onModel={vi.fn()} />);
    expect(screen.queryByLabelText("Model")).toBeNull();
    rerender(
      <Composer
        onSend={vi.fn()}
        busy={false}
        models={[
          { id: "a", name: "OpenAI", model: "gpt-4o" },
          { id: "b", name: "Ollama", model: "qwen" },
        ]}
        onModel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });
});
