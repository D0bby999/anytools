/**
 * The latest conversations under Chat in the sidebar (plan 261021-1100
 * phase 1), and the conversation search.
 */
import { act, useRef } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { RecentConversations, setLiveConversation } from "~/components/chat/recent-conversations";
import { FoldsProvider } from "~/components/chat/folds";
import { ProcessRow } from "~/components/chat/process-row";
import { SearchBar } from "~/components/chat/search-bar";
import { useChatSearch } from "~/hooks/use-chat-search";

beforeAll(() => {
  initI18n("en");
});

const sessions = [
  { id: "s1", title: "Cells", running: false },
  { id: "s2", title: "", running: true },
  { id: "s3", title: "Ohm's law" },
];

function renderRows(current?: string) {
  const router = createMemoryRouter([
    { path: "/", element: <RecentConversations sessions={sessions} current={current} /> },
    { path: "/chat", element: <p>list</p> },
  ]);
  return render(<RouterProvider router={router} />);
}

describe("recent conversations", () => {
  it("lists them under a label, marks the open one and ends with All conversations", () => {
    renderRows("s1");
    const list = screen.getByRole("list", { name: "Recent conversations" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Cells Current section", "Untitled conversationAnswer in progress", "Ohm's law", "All conversations"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).toHaveAttribute("href", "/chat/s1");
  });

  it("puts the open conversation's dot on its live stream, not the last load", () => {
    renderRows("s2");
    expect(screen.queryAllByTestId("running-dot")).toHaveLength(0);
    act(() => setLiveConversation("s2"));
    expect(screen.getAllByTestId("running-dot")).toHaveLength(1);
    act(() => setLiveConversation(null));
  });

  it("asks before deleting from the row's menu", async () => {
    renderRows("s1");
    await userEvent.click(screen.getByRole("button", { name: "Actions for Ohm's law" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete “Ohm's law”?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("link", { name: "Ohm's law" })).toBeInTheDocument();
  });

  it("renames inline from the row's menu", async () => {
    renderRows("s1");
    await userEvent.click(screen.getByRole("button", { name: "Actions for Cells" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("textbox")).toHaveValue("Cells");
  });
});

function Transcript() {
  const root = useRef<HTMLDivElement>(null);
  const search = useChatSearch(root, "k");
  return (
    <>
      <button type="button" onClick={search.show}>
        open find
      </button>
      <SearchBar search={search} />
      <div ref={root}>
        <p data-chat-searchable>Định luật Ôm nói về điện trở.</p>
        <ProcessRow turnId="a1" state="done" work={{ steps: [{ tool: "rag_search", detail: "dien tro" }] }} />
      </div>
    </>
  );
}

describe("find in a conversation", () => {
  it("finds without diacritics, counts, and opens the fold holding a match", async () => {
    render(
      <FoldsProvider>
        <Transcript />
      </FoldsProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "open find" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Find in this conversation" }), "dien tro");
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    // The second match is inside the folded process row, which opened.
    expect(screen.getByTestId("process-turn")).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();
  });
});
