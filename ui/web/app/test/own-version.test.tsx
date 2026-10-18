/**
 * own-version.test.tsx
 * "Write your own version first" (up-methods phase 11) in the browser: the
 * three lines appear only with the switch on and hold Send until written,
 * the transcript shows them, and "Close it and retell" hides the answer while
 * the learner writes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useFetcher } from "react-router";
import { initI18n } from "~/lib/i18n";
import { Composer } from "~/components/chat/composer";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { SolveForm } from "~/components/solve/solve-form";
import { OwnVersionSetting } from "~/components/settings/own-version-setting";
import { exchangeOwnVersions, ownVersionComplete, readOwnVersion } from "~/lib/own-version";

beforeAll(() => {
  initI18n("en");
});

const LINES = { understanding: "Gradients point uphill", uncertain: "Why the minus sign", proof: "Derive one step by hand" };

/** Renders inside a data router, because the retell box and forms use fetchers. */
function renderRouted(ui: React.ReactElement, action?: () => unknown) {
  const router = createMemoryRouter(
    [
      { path: "/", element: ui, action: async () => ({ ok: true }) },
      { path: "/app/api/retell", action: action ?? (async () => ({ ok: true, retell: { text: "x", written_at: "" } })) },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

async function fillLines() {
  await userEvent.type(screen.getByLabelText("What I understand now"), LINES.understanding);
  await userEvent.type(screen.getByLabelText("What I am least sure of"), LINES.uncertain);
  await userEvent.type(screen.getByLabelText("What would show I have learned it"), LINES.proof);
}

describe("Composer with own version first", () => {
  it("shows no lines with the switch off", () => {
    render(<Composer onSend={vi.fn()} busy={false} />);
    expect(screen.queryByLabelText("What I understand now")).toBeNull();
  });

  it("holds Send until all three lines are written, then sends them", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} ownVersionFirst />);

    const box = screen.getByLabelText("Your message");
    await userEvent.type(box, "Why does gradient descent subtract?");
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    expect(screen.getByText("Fill in all three lines to send.")).toBeInTheDocument();

    await userEvent.type(box, "{Enter}");
    expect(onSend).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("What I understand now"), LINES.understanding);
    await userEvent.type(screen.getByLabelText("What I am least sure of"), LINES.uncertain);
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What would show I have learned it"), "   ");
    expect(send).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("What would show I have learned it"));
    await userEvent.type(screen.getByLabelText("What would show I have learned it"), LINES.proof);
    expect(send).toBeEnabled();

    await userEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("Why does gradient descent subtract?", LINES);
    expect(screen.getByLabelText("What I understand now")).toHaveValue("");
  });
});

describe("MessageList with own version", () => {
  const question: ChatTurnView = { id: "q1", role: "user", content: "Why?", sources: [], ownVersion: LINES };
  const answer: ChatTurnView = {
    id: "a1",
    role: "assistant",
    content: "ANSWER-TEXT: the gradient points uphill.",
    sources: [],
    capability: "chat",
    ownVersion: LINES,
  };

  it("shows the three lines on the learner's message", () => {
    renderRouted(<MessageList turns={[question]} />);
    expect(screen.getByText(LINES.uncertain)).toBeInTheDocument();
    expect(screen.getByText("What I am least sure of")).toBeInTheDocument();
  });

  it("offers no retell under an answer whose question had no lines", async () => {
    renderRouted(<MessageList turns={[{ ...answer, ownVersion: undefined }]} />);
    await screen.findByText(/ANSWER-TEXT/);
    expect(screen.queryByRole("button", { name: "Close it and retell" })).toBeNull();
  });

  it("hides the answer while the learner retells, and shows the retell beside the lines after saving", async () => {
    const saved = vi.fn(async ({ request }: { request: Request }) => {
      const form = await request.formData();
      return { ok: true, retell: { text: String(form.get("text")), written_at: "2026-10-16T00:00:00Z" } };
    });
    renderRouted(<MessageList turns={[answer]} />, saved as never);

    await screen.findByText(/ANSWER-TEXT/);
    await userEvent.click(screen.getByRole("button", { name: "Close it and retell" }));
    expect(screen.queryByText(/ANSWER-TEXT/)).toBeNull();
    expect(screen.getByText("The answer is hidden while you retell it.")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save retell" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Your retell, without looking"), "MY-RETELL in my own words");
    await userEvent.click(save);

    // `selector: "p"`: React mirrors a controlled textarea's value into its
    // text, so an unscoped query can match the box being typed in, which
    // unmounts a moment later.
    expect(await screen.findByText("MY-RETELL in my own words", { selector: "p" }, { timeout: 5000 })).toBeInTheDocument();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/ANSWER-TEXT/)).toBeInTheDocument();
    expect(screen.getByText(LINES.proof)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retell again" })).toBeInTheDocument();
  });

  it("cancelling brings the answer back without saving", async () => {
    renderRouted(<MessageList turns={[answer]} />);
    await screen.findByText(/ANSWER-TEXT/);
    await userEvent.click(screen.getByRole("button", { name: "Close it and retell" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/ANSWER-TEXT/)).toBeInTheDocument();
  });

  it("a reloaded answer shows its saved retell", async () => {
    renderRouted(<MessageList turns={[{ ...answer, retell: { text: "SAVED-RETELL", written_at: "" } }]} />);
    expect(await screen.findByText("SAVED-RETELL")).toBeInTheDocument();
  });
});

describe("SolveForm with own version first", () => {
  /** A fetcher needs a data router; the stub one in renderRouted is enough. */
  function Page({ on }: { on: boolean }) {
    const fetcher = useFetcher();
    return <SolveForm fetcher={fetcher} kbs={[]} busy={false} onStop={() => {}} ownVersionFirst={on} />;
  }

  it("asks for the lines only with the switch on, and holds the submit until they are written", async () => {
    const { unmount } = renderRouted(<Page on={false} />);
    expect(await screen.findByRole("button", { name: /Solve/ })).toBeEnabled();
    expect(screen.queryByLabelText("What I understand now")).toBeNull();
    unmount();

    renderRouted(<Page on />);
    const submit = await screen.findByRole("button", { name: /Solve/ });
    expect(submit).toBeDisabled();
    await fillLines();
    expect(submit).toBeEnabled();
  });
});

describe("Settings switch", () => {
  it("is a switch that reports its state and posts the opposite", () => {
    renderRouted(<OwnVersionSetting on={false} pending={false} saved={false} failed="" />);
    const sw = screen.getByRole("switch", { name: "Write my own version first" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(document.querySelector('input[name="enabled"]')).toHaveValue("true");
  });
});

describe("own-version helpers", () => {
  it("an answer gets the lines of its exchange, across an ask_user reply", () => {
    const att = { own_version: LINES };
    const map = exchangeOwnVersions([
      { id: "q1", role: "user", attachments: att },
      { id: "r1", role: "user", attachments: [] },
      { id: "a1", role: "assistant", attachments: [] },
      { id: "q2", role: "user", attachments: [] },
      { id: "a2", role: "assistant", attachments: { sources: [] } },
    ]);
    expect(map.get("q1")).toEqual(LINES);
    expect(map.get("a1")).toEqual(LINES);
    expect(map.has("r1")).toBe(false);
    expect(map.has("a2")).toBe(false);
  });

  it("reads lines from a form only when some were written", () => {
    const empty = new FormData();
    expect(readOwnVersion(empty)).toBeUndefined();
    const form = new FormData();
    form.set("own_understanding", " a ");
    form.set("own_uncertain", "b");
    form.set("own_proof", "c");
    expect(readOwnVersion(form)).toEqual({ understanding: "a", uncertain: "b", proof: "c" });
  });

  it("counts characters, not UTF-16 units, against the 500 cap", () => {
    expect(ownVersionComplete({ understanding: "😀".repeat(500), uncertain: "b", proof: "c" })).toBe(true);
    expect(ownVersionComplete({ understanding: "😀".repeat(501), uncertain: "b", proof: "c" })).toBe(false);
  });
});
