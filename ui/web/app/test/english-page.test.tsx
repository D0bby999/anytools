/**
 * english-page.test.tsx
 * The English page (routes/english.tsx) gathers what is served: the
 * diagnostic first, each skill's kinds, a document kind started from a
 * document rather than /toolkit/new, the vocabulary deck's due count, and
 * nothing for a kind the server does not serve.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";
import { NAV_ITEMS } from "~/components/layout/sidebar";
import { partOf } from "~/lib/parts";

const { default: English } = await import("~/routes/english");

beforeAll(async () => {
  await initI18n("en");
});

const kind = (k: string, name: string, attach: WorksheetKind["attach"] = "state"): WorksheetKind =>
  ({ kind: k, name, group: "language", summary: `${name} summary`, attach, private: false, version: 1, sections: [], source: "" }) as unknown as WorksheetKind;

function show(kinds: WorksheetKind[], list: WorksheetSummary[] = [], vocabDue: number | null = 3) {
  const Page = English as unknown as (p: { loaderData: unknown }) => ReactElement;
  return render(
    <MemoryRouter>
      <Page loaderData={{ kinds, list, vocabDue }} />
    </MemoryRouter>,
  );
}

describe("the English page", () => {
  it("starts with the diagnostic and groups the rest by skill", () => {
    show([kind("english_diagnostic", "English diagnostic"), kind("speaking_evidence", "Speaking evidence")]);
    const start = screen.getByRole("region", { name: "Start here" });
    expect(within(start).getByRole("link", { name: "New English diagnostic" })).toHaveAttribute(
      "href",
      "/toolkit/new?kind=english_diagnostic",
    );
    const speaking = screen.getByRole("region", { name: "Speaking" });
    expect(within(speaking).getByText("Speaking evidence")).toBeInTheDocument();
  });

  it("starts a document kind from a document", () => {
    show([{ ...kind("listening_audit", "Listening audit", "document"), document_kinds: ["youtube", "media"] }, kind("reading_evidence", "Reading evidence", "document")]);
    const listening = screen.getByRole("region", { name: "Listening" });
    expect(within(listening).getByRole("link", { name: "Start Listening audit from a video or recording" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "Start Reading evidence from a document" })).toHaveAttribute("href", "/knowledge");
    expect(within(listening).queryByRole("link", { name: /^New/ })).toBeNull();
  });

  it("says nothing of an empty deck", () => {
    show([], [], 0);
    expect(screen.queryByText(/due for review today/)).toBeNull();
  });

  it("says what the vocabulary deck has due, and leaves out what is not served", () => {
    show([]);
    const vocab = screen.getByRole("region", { name: "Vocabulary" });
    expect(within(vocab).getByText("3 words are due for review today.")).toBeInTheDocument();
    expect(within(vocab).getByRole("link", { name: "Open vocabulary" })).toHaveAttribute("href", "/mastery/vocabulary");
    expect(screen.queryByRole("region", { name: "Speaking" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Start here" })).toBeNull();
  });

  it("is on the rail, in Practise", () => {
    expect(NAV_ITEMS.find((n) => n.to === "/english")?.part).toBe("practise");
    expect(partOf("/english")).toBe("practise");
  });
});
