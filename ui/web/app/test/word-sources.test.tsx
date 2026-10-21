/**
 * word-sources.test.tsx
 * A word's sentences and recordings from open sources (the private design notes, phase 6): shown credited, one taken by keyboard,
 * a source that is down said so.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";
import { WordSources } from "~/components/vocab/word-sources";

beforeAll(() => initI18n("en"));

const note = { id: "n1", term: "carefully", lang: "en", contexts: [] };

function show(sentences: () => Response, onUse = vi.fn()) {
  const router = createMemoryRouter(
    [
      { path: "/mastery/vocabulary", element: <WordSources note={note} onClose={() => {}} /> },
      {
        path: "/mastery/vocabulary/sources",
        loader: ({ request }) => {
          const kind = new URL(request.url).searchParams.get("kind");
          if (kind === "sentences") return sentences();
          return Response.json({ recordings: [{ id: "commons:LL-Q1860 (eng)-Vealhurl-carefully.wav", speaker: "Vealhurl", licence: "CC BY-SA 4.0", page: "https://commons.wikimedia.org/wiki/File:x", source: "Lingua Libre" }] });
        },
        action: async ({ request }) => {
          const form = await request.formData();
          onUse(Object.fromEntries(form));
          return Response.json({ used: form.get("sentence") });
        },
      },
    ],
    { initialEntries: ["/mastery/vocabulary"] },
  );
  render(<RouterProvider router={router} />);
}

describe("a word's sentences and recordings", () => {
  it("shows Tatoeba's sentences credited, and takes one by keyboard", async () => {
    const onUse = vi.fn();
    show(
      () =>
        Response.json({
          sentences: [
            { id: 2107662, text: "Watch carefully.", licence: "CC BY 2.0 FR", author: "CK", url: "https://tatoeba.org/en/sentences/show/2107662", translation: { text: "Mira con cuidado.", licence: "CC BY 2.0 FR", author: "x" } },
          ],
        }),
      onUse,
    );
    expect(await screen.findByText("Watch carefully.")).toBeInTheDocument();
    expect(screen.getByText("Mira con cuidado.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tatoeba · CK · CC BY 2.0 FR" })).toHaveAttribute("href", "https://tatoeba.org/en/sentences/show/2107662");
    const audio = await screen.findByLabelText("carefully, said by Vealhurl");
    expect(audio.getAttribute("src")).toContain("kind=audio");
    const use = screen.getByRole("button", { name: "Use “Watch carefully.” as the word's sentence" });
    use.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onUse).toHaveBeenCalledWith({ id: "n1", sentence: "Watch carefully.", credit: "Tatoeba · CK · CC BY 2.0 FR", url: "https://tatoeba.org/en/sentences/show/2107662" }));
    expect(await screen.findByText(/Saved as the word's sentence/)).toBeInTheDocument();
  });

  it("says when Tatoeba did not answer", async () => {
    show(() => Response.json({ error: "x", unavailable: true }, { status: 502 }));
    expect(await screen.findByText("Tatoeba did not answer. Try again later.")).toBeInTheDocument();
  });
});
