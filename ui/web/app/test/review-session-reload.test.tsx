/**
 * review-session-reload.test.tsx
 * A review reloads the page's due cards without the card just reviewed (the
 * Vocabulary and Decks pages both do). The session follows the cards by id:
 * the next card starts unanswered, the count goes on, and the last review
 * says the session is finished. Focus goes on with the keyboard: to the
 * ratings once the answer is shown (the suggested one first), and to the
 * next card once a card is rated.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { initI18n } from "~/lib/i18n";
import { ReviewSession } from "~/components/vocab/review-session";
import type { DueCard } from "~/lib/vocab-types";

beforeAll(() => {
  initI18n("en");
});

const card = (id: string, front: string, back: string): DueCard => ({
  id,
  note_id: `n-${id}`,
  kind: "card",
  due_at: "2026-10-20T00:00:00Z",
  reps: 1,
  term: front,
  lang: "",
  reading: "",
  pos: "",
  meaning: "",
  context: "",
  front,
  back,
  deck: { id: "d1", name: "Capitals" },
});

function Page() {
  const { cards } = useLoaderData() as { cards: DueCard[] };
  return <ReviewSession cards={cards} total={cards.length} />;
}

function renderReloading(due: DueCard[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Page />,
        loader: () => ({ cards: [...due] }),
        action: async ({ request }) => {
          const id = String((await request.formData()).get("card_id"));
          due.splice(
            due.findIndex((c) => c.id === id),
            1,
          );
          return { reviewed: id };
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("a review session whose due cards reload", () => {
  it("shows the next card unanswered, counts on, and finishes", async () => {
    renderReloading([card("a", "France", "Paris"), card("b", "Japan", "Tokyo")]);
    expect(await screen.findByText("France")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText("Paris")).toBeInTheDocument();
    // Shown by a click or a key, the answer leaves focus on a rating.
    expect(screen.getByRole("button", { name: "Again" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(await screen.findByText("Japan")).toBeInTheDocument();
    expect(screen.queryByText("Tokyo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();
    // The loader can show the next card before the review-confirmation effect updates the count.
    expect(await screen.findByText(/2 of 2/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    await userEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(await screen.findByText("That is everything due today.")).toHaveFocus();
  });
});
