/**
 * languages-picker.test.tsx
 * The Languages picker and its routes (plans/261020-1535-beyond-english-
 * learning-areas, phase 1): suggestions from the saved words, ticked on a
 * first visit; a search over every language; nothing to save until one is
 * ticked; the list keeps the learner's order; /english lands on English's
 * tab and adds English; dictionary links per language.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const vocab = { studiedLanguages: vi.fn(), setStudiedLanguages: vi.fn() };
vi.mock("~/lib/vocab.server", () => vocab);

const { LanguagePicker } = await import("~/components/languages/language-picker");
const { nextStudied, loader: pickerLoader } = await import("~/routes/languages");
const { loader: englishLoader } = await import("~/routes/english");
const { lookups, readingKind, languageName, languageNameInSentence, nativeName } = await import("~/lib/languages");

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  vocab.studiedLanguages.mockReset();
  vocab.setStudiedLanguages.mockReset().mockResolvedValue({});
});

function picker(props: Parameters<typeof LanguagePicker>[0]) {
  const router = createMemoryRouter([{ path: "/languages", element: <LanguagePicker {...props} />, action: () => null }], {
    initialEntries: ["/languages"],
  });
  return render(<RouterProvider router={router} />);
}

describe("the picker", () => {
  it("suggests the saved words' languages, ticked, and does not list them twice", () => {
    picker({ saved: [{ lang: "en", words: 51, due: 3 }, { lang: "vi", words: 1, due: 0 }], studied: [], current: "" });
    const suggested = screen.getByRole("group", { name: "Suggested from the words you saved" });
    expect(within(suggested).getByRole("checkbox", { name: /English.*51 words/ })).toBeChecked();
    expect(within(suggested).getByRole("checkbox", { name: /Tiếng Việt.*1 word/ })).toBeChecked();
    const common = screen.getByRole("group", { name: "Often learned" });
    expect(within(common).queryByRole("checkbox", { name: /^English/ })).toBeNull();
    expect(within(common).getByRole("checkbox", { name: /日本語/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start learning" })).toBeEnabled();
  });

  it("cannot save nothing, and says why", () => {
    picker({ saved: [], studied: [], current: "" });
    expect(screen.queryByRole("group", { name: /Suggested/ })).toBeNull();
    const submit = screen.getByRole("button", { name: "Start learning" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("Choose at least one language.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Français/ }));
    expect(submit).toBeEnabled();
  });

  it("finds any language by name, and keeps a found one after the search changes", () => {
    picker({ saved: [], studied: ["en"], current: "en" });
    const search = screen.getByRole("searchbox", { name: "Find a language" });
    fireEvent.change(search, { target: { value: "swahili" } });
    expect(screen.getByText("1 language matches")).toBeInTheDocument();
    const found = screen.getByRole("checkbox", { name: /Kiswahili/ });
    found.focus();
    fireEvent.click(found);
    // Ticked, it stays where it is, so the keyboard's focus stays on it.
    expect(screen.getByRole("checkbox", { name: /Kiswahili/ })).toBe(found);
    expect(found).toHaveFocus();
    expect(screen.getAllByRole("checkbox", { name: /Kiswahili/ })).toHaveLength(1);
    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("No language by that name.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Kiswahili/ })).toBeChecked();
    expect(screen.getByRole("link", { name: "Back to English" })).toHaveAttribute("href", "/languages/en");
    expect(screen.getByText(/its words stay in your vocabulary/)).toBeInTheDocument();
  });
});

describe("the list's order", () => {
  it("keeps what stays where it was, then adds, and opens the first added", () => {
    expect(nextStudied(["en", "ja"], "ja", ["ko", "ja", "en"])).toEqual({ studied: ["en", "ja", "ko"], current: "ko" });
    expect(nextStudied(["en", "ja"], "ja", ["en"])).toEqual({ studied: ["en"], current: "en" });
    expect(nextStudied(["en", "ja"], "ja", ["ja", "en"])).toEqual({ studied: ["en", "ja"], current: "ja" });
    expect(nextStudied([], "", ["vi", "vi", "en"])).toEqual({ studied: ["vi", "en"], current: "vi" });
  });
});

describe("the routes", () => {
  const req = (url: string) => ({ request: new Request(url), params: {}, context: {} }) as never;

  it("opens the language viewed last, or the picker to change the list", async () => {
    vocab.studiedLanguages.mockResolvedValue({ studied: ["en", "ja"], current: "ja", saved: [] });
    const res = (await pickerLoader(req("http://localhost/languages")).catch((r: Response) => r)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/languages/ja");
    await expect(pickerLoader(req("http://localhost/languages?edit"))).resolves.toMatchObject({ studied: ["en", "ja"] });
  });

  it("lands an old /english link on English's tab, adding English", async () => {
    vocab.studiedLanguages.mockResolvedValue({ studied: ["ja"], current: "ja", saved: [] });
    const res = (await englishLoader(req("http://localhost/english"))) as Response;
    expect(res.headers.get("Location")).toBe("/languages/en");
    expect(vocab.setStudiedLanguages).toHaveBeenCalledWith("user-1", ["ja", "en"], "en");
    vocab.setStudiedLanguages.mockClear();
    vocab.studiedLanguages.mockResolvedValue({ studied: ["en"], current: "en", saved: [] });
    await englishLoader(req("http://localhost/english"));
    expect(vocab.setStudiedLanguages).not.toHaveBeenCalled();
  });

  it("leaves a full list as it is, and says so when asked to add to it", async () => {
    const full = ["ja", "zh", "ko", "fr", "de", "es", "pt", "it", "ru", "vi", "ar", "hi", "th", "tr", "pl", "nl", "sv", "el", "he", "id"];
    vocab.studiedLanguages.mockResolvedValue({ studied: full, current: "ja", saved: [] });
    vocab.setStudiedLanguages.mockClear();
    const res = (await englishLoader(req("http://localhost/english"))) as Response;
    expect(res.headers.get("Location")).toBe("/languages/en");
    expect(vocab.setStudiedLanguages).not.toHaveBeenCalled();
    const { action } = await import("~/routes/languages.$lang");
    const out = await action({ request: new Request("http://localhost/languages/en", { method: "POST" }), params: { lang: "en" } } as never);
    expect(out).toEqual({ full: true });
    expect(vocab.setStudiedLanguages).not.toHaveBeenCalled();
  });
});

describe("a language's profile", () => {
  it("names languages in the learner's language and in themselves", () => {
    expect(languageName("ja", "vi")).toBe("Tiếng Nhật");
    expect(languageNameInSentence("ja", "vi")).toBe("tiếng Nhật");
    expect(languageNameInSentence("ja", "en")).toBe("Japanese");
    expect(nativeName("ja")).toBe("日本語");
  });

  it("looks a word up in its language's dictionary, then Wiktionary in the learner's", () => {
    expect(lookups("ja", "勉強", "vi")).toEqual([
      { name: "Jisho", url: "https://jisho.org/search/%E5%8B%89%E5%BC%B7" },
      { name: "Wiktionary", url: "https://vi.wiktionary.org/wiki/%E5%8B%89%E5%BC%B7" },
    ]);
    expect(lookups("sw", "habari", "de").map((l) => l.url)).toEqual(["https://en.wiktionary.org/wiki/habari"]);
    expect(lookups("pt-BR", "saudade", "en")[0]?.name).toBe("WordReference");
  });

  it("calls a reading pinyin or furigana where it is one", () => {
    expect(readingKind("zh-TW")).toBe("pinyin");
    expect(readingKind("ja")).toBe("furigana");
    expect(readingKind("ko")).toBe("reading");
  });
});
