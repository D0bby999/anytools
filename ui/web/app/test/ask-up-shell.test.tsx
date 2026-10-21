/**
 * ask-up-shell.test.tsx — Part II · Ask in the up shell (plan 261020-2246,
 * phase 09): a conversation reads as a chapter. The learner's question is a
 * block of its own and never a heading, so the outline never lists it; the
 * aside is "Sources", numbered as the answer's superscripts; follow-ups are
 * arrow-led links that still send their words.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { CitationChip } from "~/components/chat/citation-chip";
import { OutlineList, useOutline } from "~/components/layout/outline";
import ChatSession from "~/routes/chat.$sessionId";

beforeAll(() => {
  initI18n("en");
});

function renderRouted(ui: React.ReactElement) {
  const router = createMemoryRouter([{ path: "/chat/:sessionId", element: ui, action: () => null }], {
    initialEntries: ["/chat/00000000-0000-4000-8000-000000000001"],
  });
  return render(<RouterProvider router={router} />);
}

const source = { kind: "chunk" as const, id: "c1", title: "Chapter 3", page: 14, document_id: "doc-1" };

const turns: ChatTurnView[] = [
  { id: "q1", role: "user", content: "Why does RRF merge two arms?", sources: [] },
  {
    id: "a1",
    role: "assistant",
    capability: "chat",
    content: "## How it works\n\nIt merges two arms [[cite:chunk:c1]] with RRF.",
    sources: [source],
    followUps: ["simpler"],
  },
];

/** The outline the shell would draw for whatever is inside #lp-main. */
function Outlined() {
  const entries = useOutline();
  return (
    <>
      <main id="lp-main">
        <MessageList turns={turns} actions={{ onFollowUp: () => {} }} />
      </main>
      <nav aria-label="On this page">
        <OutlineList entries={entries} />
      </nav>
    </>
  );
}

describe("a conversation in the up shell", () => {
  it("never makes the learner's question a heading, so the outline does not list it", async () => {
    renderRouted(<Outlined />);
    const question = screen.getByText("Why does RRF merge two arms?");
    expect(question.closest("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Why does RRF/ })).toBeNull();

    const outline = screen.getByRole("navigation", { name: "On this page" });
    // The answer's own heading is read; the question is not.
    expect(await within(outline).findByText("How it works")).toBeInTheDocument();
    expect(within(outline).queryByText(/Why does RRF/)).toBeNull();
  });

  it("sets a citation as a superscript number that still opens its page", () => {
    renderRouted(<MessageList turns={turns} />);
    const link = screen.getByRole("link", { name: "1: Open Chapter 3, page 14" });
    expect(link).toHaveAttribute("href", "/documents/doc-1?page=14");
    expect(link.closest("sup")).not.toBeNull();
  });

  it("offers follow-ups as arrow-led links that send their words", async () => {
    const onFollowUp = vi.fn();
    renderRouted(<MessageList turns={turns} actions={{ onFollowUp }} />);
    const offer = screen.getByRole("button", { name: "Explain it more simply" });
    expect(offer).toHaveTextContent("→");
    await userEvent.click(offer);
    expect(onFollowUp).toHaveBeenCalledWith("Explain that more simply, as if I were new to the subject.");
  });

  it("lists a source in the aside as number · title, page", () => {
    renderRouted(<CitationChip source={source} index={2} variant="entry" />);
    const link = screen.getByRole("link", { name: "2: Open Chapter 3, page 14" });
    expect(link.closest("sup")).toBeNull();
    expect(link).toHaveTextContent("2·Chapter 3p.14");
  });
});

describe("the conversation page", () => {
  it("titles its aside Sources and lists the last answer's passages there", () => {
    const loaderData = {
      session: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "RRF",
        kb_ids: [],
        allow_web: false,
        created_at: "2026-10-20T00:00:00Z",
        updated_at: "2026-10-20T00:00:00Z",
      },
      messages: [
        { id: "q1", role: "user", content: "Why?" },
        { id: "a1", role: "assistant", content: "Because [[cite:chunk:c1]].", capability: "chat", attachments: { sources: [source] } },
      ],
      turns: [],
      ownVersionFirst: false,
      kbs: [],
      models: [],
    };
    const props = { loaderData, params: { sessionId: loaderData.session.id } } as unknown as Parameters<typeof ChatSession>[0];
    renderRouted(<ChatSession {...props} />);

    const aside = screen.getByRole("complementary", { name: "Sources" });
    expect(within(aside).getByRole("link", { name: "1: Open Chapter 3, page 14" })).toHaveAttribute(
      "href",
      "/documents/doc-1?page=14",
    );
    // The page's h1 is the conversation's title, not the question.
    expect(screen.getByRole("heading", { level: 1, name: "RRF" })).toBeInTheDocument();
  });
});
