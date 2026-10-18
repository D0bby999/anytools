/**
 * profile-components.test.tsx
 * Settings → Learning profile: entries render their evidence as links (and a
 * gone ref as text, never a link), Edit and Delete post what the action reads,
 * proposals are accepted or rejected, and the nightly switch shows its state
 * and the last run's operations.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { EntryRow, ProposalRow, RefLinks } from "~/components/profile/profile-entries";
import { AddEntryForm, ClearProfile, ConsolidationPanel } from "~/components/profile/profile-panels";
import { refHref, type ProfileEntry, type RefView } from "~/lib/profile-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string>;

function routed(ui: React.ReactElement, posts: Post[], reply: (body: Post) => unknown = (b) => ({ ok: b.intent })) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = {};
          for (const [k, v] of form.entries()) body[k] = String(v);
          posts.push(body);
          return reply(body);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const refs: RefView[] = [
  { kind: "knowledge_point", id: "kp-1", exists: true, label: "Parametric memory", parent_id: "path-1" },
  { kind: "mistake", id: "m-1", exists: true, label: "Where does parametric memory live?", parent_id: "kb-1" },
  { kind: "skill_card", id: "card-gone", exists: false },
];

const entry: ProfileEntry = {
  id: "e-1",
  section: "struggles",
  text: "Across recent answers, recall mistakes recur on this point.",
  refs,
  origin: "consolidated",
  status: "accepted",
  op: "add",
  kb_id: "kb-1",
  kb_name: "Retrieval papers",
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
};

const kbs = [
  { id: "kb-1", name: "Retrieval papers" },
  { id: "kb-2", name: "Chemistry" },
];

describe("evidence", () => {
  it("each ref opens what it cites, and a gone ref opens nothing", () => {
    render(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <RefLinks refs={refs} /> }])} />,
    );
    expect(screen.getByRole("link", { name: "Knowledge point: Parametric memory" })).toHaveAttribute("href", "/mastery/path-1");
    expect(screen.getByRole("link", { name: /Mistake: Where does/ })).toHaveAttribute("href", "/quiz/practice?kb_id=kb-1");
    expect(screen.getByText(/Skill card · no longer exists/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("refHref covers every kind", () => {
    expect(refHref({ kind: "knowledge_base", id: "kb 1", exists: true })).toBe("/knowledge/kb%201");
    expect(refHref({ kind: "vocab_card", id: "c", exists: true })).toBe("/mastery/vocabulary");
    expect(refHref({ kind: "skill_card", id: "c", exists: true })).toBe("/loop/cards/c");
    expect(refHref({ kind: "mistake", id: "m", exists: true })).toBe("/quiz/practice");
    expect(refHref({ kind: "knowledge_point", id: "k", exists: false, parent_id: "p" })).toBeNull();
  });
});

describe("an entry", () => {
  it("shows its text, author, knowledge base and evidence", () => {
    routed(<ul><EntryRow entry={entry} kbs={kbs} maxText={280} /></ul>, []);
    expect(screen.getByText(entry.text)).toBeInTheDocument();
    expect(screen.getByText("From your activity")).toBeInTheDocument();
    expect(screen.getByText(/About Retrieval papers/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge point: Parametric memory" })).toBeInTheDocument();
  });

  it("edits: the form posts the new text, section and knowledge base", async () => {
    const posts: Post[] = [];
    routed(<ul><EntryRow entry={entry} kbs={kbs} maxText={280} /></ul>, posts);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/nightly suggestions never change it/)).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Entry" });
    await userEvent.clear(box);
    await userEvent.type(box, "Recall slips on this point.");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Knowledge base" }), "");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(entry.text);
    expect(posts).toEqual([{ intent: "edit", id: "e-1", text: "Recall slips on this point.", section: "struggles", kb_id: "" }]);
  });

  it("deletes only after a confirmation", async () => {
    const posts: Post[] = [];
    routed(<ul><EntryRow entry={entry} kbs={kbs} maxText={280} /></ul>, posts);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(posts).toHaveLength(0);
    expect(screen.getByText("Delete this entry?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(posts).toEqual([{ intent: "delete", id: "e-1" }]));
  });

  it("shows the action's refusal", async () => {
    routed(<ul><EntryRow entry={entry} kbs={kbs} maxText={280} /></ul>, [], () => ({ errorKey: "errors.full" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already holds 12 entries");
  });
});

describe("a proposal", () => {
  const proposal: ProfileEntry = {
    ...entry,
    id: "p-1",
    status: "proposed",
    op: "update",
    replaces_id: "e-0",
    replaces_text: "Recall slips.",
  };

  it("says what it would change and posts accept or reject", async () => {
    const posts: Post[] = [];
    routed(<ul><ProposalRow entry={proposal} /></ul>, posts);
    expect(screen.getByText("Change an entry in Struggles")).toBeInTheDocument();
    expect(screen.getByText("Now: “Recall slips.”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(posts).toEqual([
        { intent: "accept", id: "p-1" },
        { intent: "reject", id: "p-1" },
      ]),
    );
  });
});

describe("the panels", () => {
  it("adds an entry and empties the form", async () => {
    const posts: Post[] = [];
    routed(<AddEntryForm kbs={kbs} maxText={280} />, posts);
    const box = screen.getByRole("textbox", { name: "What should AnyTools keep in mind?" });
    await userEvent.type(box, "Worked examples before rules.");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(box).toHaveValue(""));
    expect(posts).toEqual([{ intent: "add", text: "Worked examples before rules.", section: "preferences", kb_id: "" }]);
  });

  it("the nightly switch is off until turned on, and shows the last run's operations", async () => {
    const posts: Post[] = [];
    routed(
      <ConsolidationPanel
        on={false}
        lastRun={{
          id: "r-1",
          started_at: "2026-09-27T19:30:00Z",
          status: "succeeded",
          model: "fake-1",
          ops: [
            { op: "add", section: "struggles", text: "Recall mistakes recur.", status: "proposed" },
            { op: "add", section: "strengths", text: "Has mastered retrieval.", status: "dropped", reason: "uses an absolute word" },
          ],
        }}
      />,
      posts,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Nightly suggestions are off.");
    const ops = screen.getAllByRole("listitem");
    expect(within(ops[1]!).getByText("uses an absolute word")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(posts).toEqual([{ intent: "consolidation", on: "true" }]));
  });

  it("says when it has never run", () => {
    routed(<ConsolidationPanel on lastRun={null} />, []);
    expect(screen.getByText("It has not run yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears the profile after a confirmation", async () => {
    const posts: Post[] = [];
    routed(<ClearProfile count={3} />, posts);
    await userEvent.click(screen.getByRole("button", { name: "Clear profile" }));
    expect(posts).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, clear it" }));
    expect(await screen.findByText("The profile is empty.")).toBeInTheDocument();
    expect(posts).toEqual([{ intent: "clear" }]);
  });
});
