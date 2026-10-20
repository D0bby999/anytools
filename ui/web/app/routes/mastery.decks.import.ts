/**
 * mastery.decks.import.ts
 * Resource route (action only): a deck read in the browser, sent as cards in
 * batches (plans/261020-1535-beyond-english-learning-areas, phase 5). The
 * first batch creates the deck; each answers with the deck's id and what it
 * added. Its own requireUser: a resource route is not under app-layout's guard.
 */
import type { Route } from "./+types/mastery.decks.import";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addDeckCards, createDeck, DECK_BATCH, type DeckCard } from "~/lib/decks.server";

type Body = { deck_id?: string; name?: string; source?: string; cards?: DeckCard[] };

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "malformed request body" }, { status: 400 });
  }
  const cards = Array.isArray(body.cards) ? body.cards.slice(0, DECK_BATCH) : [];
  try {
    let deckId = body.deck_id ?? "";
    if (!deckId) {
      const deck = await createDeck(user.id, { name: String(body.name ?? "").slice(0, 200), source: String(body.source ?? "").slice(0, 500) });
      deckId = deck.id;
    }
    const result = await addDeckCards(user.id, deckId, cards);
    return Response.json({ deck_id: deckId, ...result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof ApiError ? error.message : "could not add the cards" }, { status });
  }
}
