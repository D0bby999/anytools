/**
 * vocab-decisions.test.tsx
 * up-methods phase 3: up's five decisions about an unknown word in the word
 * picker (inference before lookup), the week's "five to eight", the
 * production card in review, Mastery → Vocabulary by decision, and the copy
 * into a vocabulary audit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { WordPicker } from "~/components/vocab/word-picker";
import { ReviewSession } from "~/components/vocab/review-session";
import { WordList } from "~/components/vocab/word-list";
import { WeekNotice } from "~/components/vocab/week-notice";
import { auditRow, decisionBody, type DueCard, type VocabNote } from "~/lib/vocab-types";
import type { WorksheetSummary } from "~/lib/worksheet-types";

beforeAll(() => {
  initI18n("en");
});

type Post = Record<string, string | string[]>;

function routed(ui: React.ReactElement, posts: Post[], reply: (body: Post) => unknown = () => ({})) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: ui,
        action: async ({ request }) => {
          const form = await request.formData();
          const body: Post = {};
          for (const [k, v] of form.entries()) {
            const prev = body[k];
            body[k] = prev === undefined ? String(v) : [...(Array.isArray(prev) ? prev : [prev]), String(v)];
          }
          posts.push(body);
          return reply(body);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function note(over: Partial<VocabNote>): VocabNote {
  return {
    id: "n1",
    term: "equilibrium",
    lang: "en",
    reading: "",
    pos: "noun",
    meaning: "A balanced state.",
    contexts: [],
    cards: [],
    suspended: false,
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    decision: "learn",
    record: {},
    task_impact: "",
    decided_at: "2026-10-16T00:00:00Z",
    scenario: "",
    confusable: "",
    production: false,
    ...over,
  };
}

const terms = { terms: [{ term: "equilibrium", meaning: "A balanced state.", pos: "noun" }], lang: "en" };

describe("the word picker's five decisions", () => {
  it("lists five decisions, each asking for up's minimum record, and keeps the meaning back", async () => {
    const posts: Post[] = [];
    routed(<WordPicker selection="a system at equilibrium" page={3} />, posts, (b) =>
      b.intent === "terms" ? { ...terms, existing: [] } : { savedWord: true, created: true, note: note({ decision: "infer" }) },
    );
    await userEvent.click(screen.getByRole("button", { name: "Find words to save" }));
    await screen.findByText("equilibrium");

    const radios = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(radios).toEqual(["skip", "infer", "lookup", "learn", "verify"]);
    for (const name of ["Skip", "Infer", "Quick lookup", "Learn deliberately", "Verify professionally"]) {
      expect(screen.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(screen.queryByText("A balanced state.")).not.toBeInTheDocument();

    const records: Record<string, string[]> = {
      Skip: ["Why it can wait"],
      "Quick lookup": ["Source of the current sense", "Current sense"],
      "Learn deliberately": ["Sound", "Collocation", "Retrieval cue", "Current sense"],
      "Verify professionally": ["Primary definition", "Scope", "Accountable owner"],
    };
    for (const [decision, fields] of Object.entries(records)) {
      await userEvent.click(screen.getByRole("radio", { name: new RegExp(`^${decision}`) }));
      for (const f of fields) expect(screen.getByLabelText(f)).toBeRequired();
    }
    // Skip and verify show the suggestion once decided; it is a candidate.
    expect(screen.getByText("A balanced state.")).toBeInTheDocument();

    // Infer: the suggestion waits for the learner's own candidate sense.
    await userEvent.click(screen.getByRole("radio", { name: /^Infer/ }));
    expect(screen.queryByText("A balanced state.")).not.toBeInTheDocument();
    expect(screen.getByText("Write your candidate sense first; the suggestion appears after.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Confidence"), "medium");
    await userEvent.type(screen.getByLabelText("Your candidate sense"), "a steady balance");
    expect(screen.getByText("A balanced state.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Task impact"), "important");
    await userEvent.click(screen.getByRole("button", { name: "Save the decision" }));
    await screen.findByText("Saved as Infer.");
    expect(posts[1]).toMatchObject({
      intent: "save-word",
      term: "equilibrium",
      decision: "infer",
      record_sense: "a steady balance",
      record_confidence: "medium",
      task_impact: "important",
    });
  });

  it("shows a word already decided and changes it by PATCH, with the week's notice", async () => {
    const posts: Post[] = [];
    const skipped = note({ decision: "skip", record: { why: "one-off detail" }, meaning: "" });
    routed(<WordPicker selection="a system at equilibrium" page={3} />, posts, (b) =>
      b.intent === "terms"
        ? { ...terms, existing: [skipped] }
        : {
            savedWord: true,
            changed: true,
            note: note({ decision: "learn", record: { sound: "s", collocation: "c", cue: "q" } }),
            week: { learning: 7, notice: "select" },
          },
    );
    await userEvent.click(screen.getByRole("button", { name: "Find words to save" }));
    expect(await screen.findByText("You already decided on this word: Skip.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change the decision" }));
    expect(screen.getByLabelText("Why it can wait")).toHaveValue("one-off detail");
    await userEvent.click(screen.getByRole("radio", { name: /^Learn deliberately/ }));
    await userEvent.type(screen.getByLabelText("Sound"), "ee-kwi-LIB-ree-um");
    await userEvent.type(screen.getByLabelText("Collocation"), "reach equilibrium");
    await userEvent.type(screen.getByLabelText("Retrieval cue"), "two forces cancel out");
    // The suggestion is there to edit, not to accept blindly.
    expect(screen.getByLabelText("Current sense")).toHaveValue("A balanced state.");
    await userEvent.clear(screen.getByLabelText("Current sense"));
    await userEvent.type(screen.getByLabelText("Current sense"), "a balanced state");
    await userEvent.click(screen.getByRole("button", { name: "Save the decision" }));

    expect(await screen.findByText("Decision changed to Learn deliberately.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("That is 7 words to learn this week.");
    expect(posts[1]).toMatchObject({
      intent: "decide-word",
      id: "n1",
      decision: "learn",
      record_sound: "ee-kwi-LIB-ree-um",
      record_collocation: "reach equilibrium",
      record_cue: "two forces cancel out",
      meaning: "a balanced state",
    });
  });
});

describe("five to eight per cycle", () => {
  it("says nothing up to five, guides from six, and warns from nine", () => {
    const { rerender } = render(<WeekNotice week={{ learning: 5 }} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    rerender(<WeekNotice week={{ learning: 6, notice: "select" }} />);
    expect(screen.getByRole("note")).toHaveTextContent("That is 6 words to learn this week. Five to eight a cycle is plenty");
    rerender(<WeekNotice week={{ learning: 9, notice: "over" }} />);
    expect(screen.getByRole("note")).toHaveTextContent("more than the five to eight a cycle can hold");
  });
});

describe("the production card", () => {
  const production: DueCard = {
    id: "card-p",
    note_id: "n1",
    kind: "production",
    due_at: "2026-10-16T00:00:00Z",
    reps: 0,
    term: "pose a risk to",
    lang: "en",
    reading: "pohz",
    pos: "verb phrase",
    meaning: "to create a danger for something",
    context: "The dependency may pose a risk to the schedule.",
    scenario: "Telling a client that a late supplier could delay the launch.",
    confusable: "run a risk: you take it on yourself",
  };

  it("fronts the learner's situation and the sense, and is answered by typing the expression", async () => {
    const posts: Post[] = [];
    routed(<ReviewSession cards={[production]} total={1} />, posts, () => ({ reviewed: "card-p" }));
    expect(screen.getByText("Type the expression that fits.")).toBeInTheDocument();
    expect(screen.getByText("Telling a client that a late supplier could delay the launch.")).toBeInTheDocument();
    expect(screen.getByText("to create a danger for something")).toBeInTheDocument();
    // The answer is not on the front.
    expect(screen.queryByText(/pose a risk to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/run a risk/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Your answer"), "Pose a risk to");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("That matches. pose a risk to");
    expect(screen.getByText("run a risk: you take it on yourself")).toBeInTheDocument();
    expect(screen.getByText("The dependency may pose a risk to the schedule.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Good/ }));
    await screen.findByText("That is everything due today.");
    expect(posts[0]).toMatchObject({ intent: "review", card_id: "card-p", rating: "good", answer: "Pose a risk to" });
  });
});

describe("Mastery → Vocabulary by decision", () => {
  const notes = [
    note({ id: "n-learn", term: "equilibrium", cards: [] }),
    note({ id: "n-skip", term: "moreover", decision: "skip", record: { why: "only a connector" }, meaning: "" }),
    note({ id: "n-infer", term: "entropy", decision: "infer", record: { sense: "disorder", confidence: "low" }, meaning: "" }),
  ];
  const audits: WorksheetSummary[] = [
    { id: "w1", kind: "vocabulary_audit", title: "Reading the chemistry text", status: "open", private: false, reviews: {}, updated_at: "2026-10-16T00:00:00Z" },
  ];

  it("lists words to learn first, groups the rest with their records, and offers Learn this", async () => {
    const posts: Post[] = [];
    routed(<WordList notes={notes} q="" lang="" langs={["en"]} audits={audits} />, posts, (b) => ({ updated: b.id }));
    expect(screen.getByText("Learning · 1 word")).toBeInTheDocument();
    expect(screen.getByText("Skip · 1 word")).toBeInTheDocument();
    expect(screen.getByText("Infer · 1 word")).toBeInTheDocument();
    expect(screen.getByText("only a connector")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();

    const skipRow = screen.getByText("moreover").closest("li")!;
    expect(within(skipRow).queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument();
    expect(within(skipRow).queryByRole("button", { name: "Practise using it" })).not.toBeInTheDocument();
    await userEvent.click(within(skipRow).getByRole("button", { name: "Learn this" }));
    expect(within(skipRow).getByRole("radio", { name: /^Learn deliberately/ })).toBeChecked();
    await userEvent.type(within(skipRow).getByLabelText("Sound"), "mor-OH-ver");
    await userEvent.type(within(skipRow).getByLabelText("Collocation"), "and moreover");
    await userEvent.type(within(skipRow).getByLabelText("Retrieval cue"), "adding a stronger point");
    await userEvent.type(within(skipRow).getByLabelText("Current sense"), "in addition");
    await userEvent.click(within(skipRow).getByRole("button", { name: "Save the decision" }));
    await screen.findByText("moreover");
    expect(posts[0]).toMatchObject({
      intent: "decide",
      id: "n-skip",
      decision: "learn",
      record_sound: "mor-OH-ver",
      meaning: "in addition",
    });
  });

  it("asks for a scenario before making the production card", async () => {
    const posts: Post[] = [];
    routed(<WordList notes={notes} q="" lang="" langs={["en"]} />, posts, (b) => ({ updated: b.id }));
    const learnRow = screen.getByText("equilibrium").closest("li")!;
    await userEvent.click(within(learnRow).getByRole("button", { name: "Practise using it" }));
    expect(within(learnRow).getByLabelText("Your situation")).toBeRequired();
    await userEvent.type(within(learnRow).getByLabelText("Your situation"), "Explaining a stable market to my team");
    await userEvent.type(
      within(learnRow).getByLabelText("A confusable expression, and the difference (optional)"),
      "balance: the thing, not the state",
    );
    await userEvent.click(within(learnRow).getByRole("button", { name: "Make the production card" }));
    await screen.findByRole("button", { name: "Practise using it" });
    expect(posts[0]).toEqual({
      intent: "practise",
      id: "n-learn",
      scenario: "Explaining a stable market to my team",
      confusable: "balance: the thing, not the state",
    });
  });

  it("copies the selected words into an open vocabulary audit", async () => {
    const posts: Post[] = [];
    routed(<WordList notes={notes} q="" lang="" langs={["en"]} audits={audits} />, posts, () => ({ auditAdded: 2 }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select moreover for the audit" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select entropy for the audit" }));
    expect(screen.getByLabelText("Vocabulary audit")).toHaveValue("w1");
    await userEvent.click(screen.getByRole("button", { name: "Add selected words" }));
    expect(await screen.findByText("2 words added to the audit.")).toBeInTheDocument();
    expect(posts[0]).toEqual({ intent: "audit", worksheet: "w1", note: ["n-skip", "n-infer"] });
  });

  it("offers to start an audit when none is open, with nothing to select", () => {
    routed(<WordList notes={notes} q="" lang="" langs={["en"]} audits={[]} />, []);
    expect(screen.getByRole("link", { name: "Start a vocabulary audit" })).toHaveAttribute(
      "href",
      "/toolkit/new?kind=vocabulary_audit",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("decision helpers", () => {
  it("reads a decision form back for the API, leaving out a meaning not posted", () => {
    const form = new FormData();
    form.set("decision", "infer");
    form.set("record_sense", " steady ");
    form.set("record_confidence", "high");
    form.set("record_why", "not part of an inference");
    form.set("task_impact", "minor");
    expect(decisionBody(form)).toEqual({
      decision: "infer",
      record: { sense: "steady", confidence: "high" },
      task_impact: "minor",
    });
    form.set("decision", "memorise");
    expect(decisionBody(form)).toBeNull();
  });

  it("turns a note into a row of the audit's decision queue, in up's words", () => {
    expect(auditRow(note({ term: "entropy", decision: "verify", task_impact: "blocking",
      record: { definition: "ISO 80000-5", scope: "thermodynamics", owner: "the lab lead" } }))).toEqual({
      row: "",
      cells: { item: "entropy", decision: "expert check", impact: "blocking", basis: "ISO 80000-5; thermodynamics; the lab lead" },
    });
    expect(auditRow(note({ decision: "lookup", record: { source: "Cambridge" } })).cells.decision).toBe("quick lookup");
    expect(auditRow(note({ decision: "learn", record: {} })).cells).toEqual({ item: "equilibrium", decision: "learn" });
  });
});
