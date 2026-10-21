/**
 * languages-page.test.tsx
 * Languages (the private design notes, phase 1;
 * ux/01-languages.md): one tab per studied language, that language's words
 * due and the review narrowed to them, the diagnostic named for the
 * language, each skill's kinds, a language opened from a link offered to the
 * list, and nothing for a kind the server does not serve.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactElement } from "react";
import { initI18n } from "~/lib/i18n";
import type { WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";
import type { SavedLanguage } from "~/lib/languages";
import { NAV_ITEMS } from "~/components/layout/sidebar";
import { partOf } from "~/lib/parts";

const { default: Language } = await import("~/routes/languages.$lang");

beforeAll(async () => {
  await initI18n("en");
});

const kind = (k: string, name: string, attach: WorksheetKind["attach"] = "state"): WorksheetKind =>
  ({ kind: k, name, group: "language", summary: `${name} summary`, attach, private: false, version: 1, sections: [], source: "" }) as unknown as WorksheetKind;

type Shown = {
  lang?: string;
  studied?: boolean;
  tabs?: string[];
  saved?: SavedLanguage[];
  kinds?: WorksheetKind[];
  list?: WorksheetSummary[];
};

function show({ lang = "ja", studied = true, tabs = ["en", "ja"], saved = [], kinds = [], list = [] }: Shown) {
  const Page = Language as unknown as (p: { loaderData: unknown }) => ReactElement;
  const mine = saved.find((s) => s.lang === lang);
  const loaderData = { lang, studied, tabs, saved, words: mine?.words ?? 0, due: mine?.due ?? 0, kinds, list, name: lang };
  const router = createMemoryRouter([{ path: "/languages/:lang", element: <Page loaderData={loaderData} />, action: () => null }], {
    initialEntries: [`/languages/${lang}`],
  });
  return render(<RouterProvider router={router} />);
}

describe("a language's page", () => {
  it("has a tab per studied language, with what is due, and a way to add one", () => {
    show({ saved: [{ lang: "en", words: 51, due: 4 }, { lang: "ja", words: 2, due: 0 }] });
    const tabs = screen.getByRole("navigation", { name: "Languages you are learning" });
    const en = within(tabs).getByRole("link", { name: /English/ });
    expect(en).toHaveAttribute("href", "/languages/en");
    expect(en).toHaveTextContent("4 words due");
    expect(within(tabs).getByRole("link", { name: "日本語" })).toHaveAttribute("href", "/languages/ja");
    expect(within(tabs).getByRole("link", { name: "+ Add a language" })).toHaveAttribute("href", "/languages?edit");
    expect(screen.getByText("日本語")).toHaveAttribute("lang", "ja");
  });

  it("keeps vocabulary in the skill navigation, and the review opens only its words", () => {
    show({ lang: "en", saved: [{ lang: "en", words: 51, due: 3 }] });
    const vocab = screen.getByRole("region", { name: "Vocabulary" });
    expect(within(vocab).getByText("3 English words are due for review today.")).toBeInTheDocument();
    expect(within(vocab).getByRole("link", { name: "Review these 3 words" })).toHaveAttribute(
      "href",
      "/mastery/vocabulary?lang=en#lp-vocab-due",
    );
    expect(within(vocab).getByRole("link", { name: "See every English word" })).toHaveAttribute(
      "href",
      "/mastery/vocabulary?lang=en#lp-vocab-words",
    );
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(regions).toEqual(["lang-listening", "lang-reading", "lang-vocabulary", "lang-lookups"]);
    expect(screen.getByRole("navigation", { name: "Skills" })).toContainElement(screen.getByRole("link", { name: "Vocabulary" }));
  });

  it("says what to do when the language has no words, and when none is due", () => {
    show({ lang: "ja" });
    expect(screen.getByText(/No Japanese words yet\. Open a document in Japanese/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Review/ })).toBeNull();
    show({ lang: "ko", tabs: ["ko"], saved: [{ lang: "ko", words: 5, due: 0 }] });
    expect(screen.getByText("No Korean words are due today.")).toBeInTheDocument();
  });

  it("names a diagnostic started here for the language", () => {
    show({ kinds: [kind("english_diagnostic", "Language diagnostic"), kind("speaking_evidence", "Speaking evidence")] });
    const start = screen.getByRole("region", { name: "Keep one baseline in five minutes" });
    expect(within(start).getByRole("link", { name: "New Language diagnostic" })).toHaveAttribute(
      "href",
      `/toolkit/new?kind=english_diagnostic&title=${encodeURIComponent("Language diagnostic — Japanese")}`,
    );
    expect(within(screen.getByRole("region", { name: "Speaking" })).getByText("Speaking evidence")).toBeInTheDocument();
  });

  it("starts a document kind from a document", () => {
    show({
      kinds: [
        { ...kind("listening_audit", "Listening audit", "document"), document_kinds: ["youtube", "media"] },
        kind("reading_evidence", "Reading evidence", "document"),
      ],
    });
    const listening = screen.getByRole("region", { name: "Listening" });
    expect(within(listening).getByRole("link", { name: "Start Listening audit from a video or recording" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "Start Reading evidence from a document" })).toHaveAttribute("href", "/knowledge");
    expect(within(listening).queryByRole("link", { name: /^New/ })).toBeNull();
  });

  it("offers a language opened from a link to the list, and leaves out what is not served", () => {
    show({ lang: "fr", studied: false, tabs: ["en"] });
    expect(screen.getByText("You have not added French.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to my list" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Speaking" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Keep one baseline in five minutes" })).toBeNull();
  });

  it("is on the rail, in Practise, and the old English page is Practise too", () => {
    expect(NAV_ITEMS.find((n) => n.to === "/languages")?.part).toBe("practise");
    expect(partOf("/languages/ja")).toBe("practise");
    expect(partOf("/english")).toBe("practise");
  });
});
