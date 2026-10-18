/**
 * card-components.test.tsx
 * Skill evidence cards, rendered: the timeline draws what the served kind
 * says, a pending retest shows that the first attempt is hidden (the API sent
 * no text to show), and the link fields parse to ids or to a sentence.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import { CardTimeline } from "~/components/loop/card-timeline";
import { CardNewForm } from "~/components/loop/card-new-form";
import { CardList, RetestsDueList } from "~/components/loop/card-list";
import { parseCardLinks, parseDocumentAddress } from "~/lib/card-links";
import type { CardDetail, CardEntry, CardKind } from "~/lib/loop-types";

beforeAll(() => {
  initI18n("en");
});

function inRouter(el: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element: el, action: () => null }]);
  return render(<RouterProvider router={router} />);
}

// A kind invented for the test: if the page renders these words, it renders
// what it was given rather than a copy of its own.
const kind: CardKind = {
  kind: "test_kind",
  name: "Test kind",
  summary: "A kind that exists only in this test.",
  retest_delay_days: 9,
  setup: [
    { key: "situation", label: "Where it happens", hint: "h", required: true },
    { key: "extra", label: "An extra field", hint: "h2", required: false },
  ],
  prompts: {
    baseline: ["Prompt for the first go."],
    immediate: ["Prompt for practice."],
    delayed: ["Prompt for the retest."],
    transfer: ["Prompt for somewhere new."],
  },
};

const entry = (over: Partial<CardEntry>): CardEntry => ({
  id: "e1", card_id: "c1", timepoint: "baseline", body: "", prompt_level: "unaided",
  links: [], withheld: false, created_at: "2026-09-28T06:30:00Z", ...over,
});

const detail = (over: Partial<CardDetail>): CardDetail => ({
  card: {
    id: "c1", state_id: "s1", chain_id: "ch1", kind: "test_kind", title: "Read a headline",
    setup: { situation: "The morning paper" }, status: "retest_due", baseline_at: "2026-09-28T06:30:00Z",
    retest_due_on: "2026-10-12", closed_at: null, reflection: {}, created_at: "2026-09-28T06:00:00Z",
  },
  kind, entries: [entry({ withheld: true })], today: "2026-09-28",
  retest_open: false, baseline_hidden: true, allowed: ["immediate"], ...over,
});

describe("CardTimeline", () => {
  it("renders the served kind's setup labels and prompts at each step", () => {
    inRouter(<CardTimeline detail={detail({})} recent={[]} busy={false} />);
    expect(screen.getByText("Where it happens")).toBeInTheDocument();
    expect(screen.getByText("The morning paper")).toBeInTheDocument();
    for (const p of ["Prompt for the first go.", "Prompt for practice.", "Prompt for the retest.", "Prompt for somewhere new."]) {
      expect(screen.getByText(p)).toBeInTheDocument();
    }
    // The step headings, in timeline order.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Setup", "First attempt, unaided", "Practice", "Retest", "Somewhere new", "Reflection"]);
  });

  it("while the retest is pending, says the first attempt is hidden and when the retest opens", () => {
    inRouter(<CardTimeline detail={detail({})} recent={[]} busy={false} />);
    expect(screen.getByText(/hidden until the retest is saved/)).toBeInTheDocument();
    expect(screen.getByText(/The retest opens on 2026-10-12/)).toBeInTheDocument();
    // Only practice may be written: one form, for practice.
    expect(screen.getAllByRole("button", { name: "Save entry" })).toHaveLength(1);
    expect(screen.getByText("Record a transfer once the retest is saved.")).toBeInTheDocument();
  });

  it("on the day, offers the retest with a help level, still without the first attempt", () => {
    inRouter(
      <CardTimeline detail={detail({ retest_open: true, allowed: ["immediate", "delayed"] })} recent={[]} busy={false} />,
    );
    expect(screen.getByText(/The retest is open/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save entry" })).toHaveLength(2);
    expect(screen.getAllByLabelText("How much help did you have?")).toHaveLength(2);
    expect(screen.getByText(/hidden until the retest is saved/)).toBeInTheDocument();
  });

  it("after the retest, shows the first attempt as text, with its links", () => {
    const open = detail({
      card: { ...detail({}).card, status: "open" },
      baseline_hidden: false,
      allowed: ["immediate", "delayed", "transfer"],
      entries: [
        entry({
          body: "<b>my first try</b>",
          links: [
            { kind: "document", id: "d1", page: 3, label: "Tuổi Trẻ", path: "/documents/d1?page=3" },
            { kind: "note", id: "n1", missing: true },
          ],
        }),
        entry({ id: "e2", timepoint: "delayed", body: "the retest", prompt_level: "light_cue" }),
      ],
    });
    inRouter(<CardTimeline detail={open} recent={[]} busy={false} />);
    // Rendered as text, never as markup.
    expect(screen.getByText("<b>my first try</b>")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tuổi Trẻ · page 3/ })).toHaveAttribute("href", "/documents/d1?page=3");
    expect(screen.getByText("This link points at something that no longer exists.")).toBeInTheDocument();
    expect(screen.getByText(/Help: A small cue/)).toBeInTheDocument();
    expect(screen.queryByText(/hidden until the retest is saved/)).not.toBeInTheDocument();
  });

  it("the first-attempt form does not ask about help, because the first attempt has none", () => {
    inRouter(
      <CardTimeline
        detail={detail({ card: { ...detail({}).card, status: "open", baseline_at: null, retest_due_on: "" },
          entries: [], baseline_hidden: false, allowed: ["baseline"] })}
        recent={[{ kind: "note", id: "n1", label: "My note" }]}
        busy={false}
      />,
    );
    expect(screen.getByText(/Save only what you did without help/)).toBeInTheDocument();
    expect(screen.queryByLabelText("How much help did you have?")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toHaveAttribute("value", "note:n1");
    // No reflection form before there is anything to reflect on.
    expect(screen.queryByRole("button", { name: "Close the card" })).not.toBeInTheDocument();
  });
});

describe("CardNewForm", () => {
  it("offers the served kinds and shows the chosen kind's own setup fields", () => {
    const other: CardKind = { ...kind, kind: "other_kind", name: "Other kind", setup: [
      { key: "listener", label: "Who hears it", hint: "", required: true }] };
    inRouter(<CardNewForm kinds={[kind, other]} busy={false} />);
    expect(screen.getAllByText("Retest after 9 days")).toHaveLength(2);
    expect(screen.getByLabelText(/An extra field/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Other kind/ }));
    expect(screen.getByLabelText(/Who hears it/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/An extra field/)).not.toBeInTheDocument();
  });
});

describe("CardList and RetestsDueList", () => {
  it("names kinds from the served table and links each card", () => {
    inRouter(
      <>
        <CardList cards={[detail({}).card]} kinds={[kind]} />
        <RetestsDueList
          retests={[{ card_id: "c1", state_id: "s1", kind: "test_kind", title: "Read a headline", retest_due_on: "2026-10-12" }]}
          kinds={[kind]}
        />
      </>,
    );
    expect(screen.getByText(/Test kind · Retest pending · Retest due 2026-10-12/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the card: Read a headline" })).toHaveAttribute("href", "/loop/cards/c1");
  });
});

describe("card links", () => {
  const id = "0b7c4a3e-1b2c-4d5e-8f90-123456789abc";

  it("reads a document address with or without a page", () => {
    expect(parseDocumentAddress(`/documents/${id}?page=3`)).toEqual({ kind: "document", id, page: 3 });
    expect(parseDocumentAddress(`https://anytools.example/documents/${id}`)).toEqual({ kind: "document", id });
    expect(parseDocumentAddress("/documents/not-an-id")).toBeNull();
    expect(parseDocumentAddress(`/notebooks/${id}`)).toBeNull();
  });

  it("turns checked links and a pasted address into ids, and refuses anything else with a sentence", () => {
    const form = new FormData();
    form.append("link", `note:${id}`);
    form.append("link", `quiz_attempt:${id}`);
    form.set("document_url", `/documents/${id}?page=2`);
    expect(parseCardLinks(form)).toEqual({
      links: [{ kind: "note", id }, { kind: "quiz_attempt", id }, { kind: "document", id, page: 2 }],
    });
    const bad = new FormData();
    bad.append("link", `chat_message:${id}`);
    expect(parseCardLinks(bad)).toHaveProperty("error");
    const badDoc = new FormData();
    badDoc.set("document_url", "somewhere else");
    expect(parseCardLinks(badDoc)).toHaveProperty("error");
  });
});
