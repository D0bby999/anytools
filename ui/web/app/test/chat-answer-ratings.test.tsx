/**
 * Like / Dislike under an answer (plan 261021-1100 phase 1, after postclaw's
 * per-answer ratings).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { useChatFeedback } from "~/hooks/use-chat-feedback";
import type { ChatFeedback } from "~/lib/chat.server";

beforeAll(() => {
  initI18n("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const turns: ChatTurnView[] = [
  { id: "q1", role: "user", content: "Why?", sources: [] },
  { id: "a1", role: "assistant", content: "Because.", sources: [], capability: "chat" },
];

function Page({ initial = [] }: { initial?: ChatFeedback[] }) {
  const feedback = useChatFeedback(initial);
  return <MessageList turns={turns} actions={{ feedback }} />;
}

function renderPage(initial?: ChatFeedback[]) {
  const router = createMemoryRouter([{ path: "/", element: <Page initial={initial} /> }]);
  return render(<RouterProvider router={router} />);
}

function stubFetch(ok = true) {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new URLSearchParams(String(init?.body ?? "")));
      return new Response(JSON.stringify(ok ? { ok: true, feedback: null } : { ok: false, error: "no" }), { status: 200 });
    }),
  );
  return calls;
}

describe("answer ratings", () => {
  it("records a Like at once and retracts it on a second press", async () => {
    const calls = stubFetch();
    renderPage();
    const like = screen.getByRole("button", { name: "Good answer" });
    await userEvent.click(like);
    expect(like).toHaveAttribute("aria-pressed", "true");
    expect(Object.fromEntries(calls[0]!)).toEqual({ intent: "put", messageId: "a1", rating: "good" });
    await userEvent.click(like);
    await waitFor(() => expect(like).toHaveAttribute("aria-pressed", "false"));
    expect(calls[1]!.get("intent")).toBe("delete");
  });

  it("asks why on a Dislike and sends the reason and comment", async () => {
    const calls = stubFetch();
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Not a good answer" }));
    const dialog = screen.getByRole("dialog", { name: "What was wrong with this answer?" });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Did not use my material" }));
    await userEvent.type(screen.getByLabelText("Anything to add (optional)"), "It ignored chapter 2");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(Object.fromEntries(calls[0]!)).toEqual({
      intent: "put",
      messageId: "a1",
      rating: "bad",
      category: "ignored_material",
      comment: "It ignored chapter 2",
    });
    expect(screen.getByRole("button", { name: "Not a good answer" })).toHaveAttribute("aria-pressed", "true");
  });

  it("rolls back a refused rating and says so", async () => {
    stubFetch(false);
    renderPage();
    const like = screen.getByRole("button", { name: "Good answer" });
    await userEvent.click(like);
    await waitFor(() => expect(like).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByRole("alert")).toHaveTextContent("The rating was not saved");
  });

  it("shows a rating made earlier as soon as the page does", () => {
    renderPage([{ message_id: "a1", rating: "bad", updated_at: "2026-10-21T00:00:00Z" }]);
    expect(screen.getByRole("button", { name: "Not a good answer" })).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no rating on an answer still streaming or not yet stored", () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <MessageList
            turns={[turns[0]!, { ...turns[1]!, id: "live-x", streaming: true }]}
            actions={{ feedback: { ratingOf: () => undefined, failed: () => false, rate: vi.fn(), retract: vi.fn() } }}
          />
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    expect(screen.queryByRole("button", { name: "Good answer" })).toBeNull();
  });
});
