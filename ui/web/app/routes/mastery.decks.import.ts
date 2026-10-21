/**
 * mastery.decks.import.ts
 * Resource route (action only): a deck read in the browser, sent as cards in
 * batches (plans/261020-1535-beyond-english-learning-areas, phase 5). The
 * first batch creates the deck; each answers with the deck's id and what it
 * added. Its own requireUser: a resource route is not under app-layout's guard.
 *
 * The body is read up to 3 MB: 200 cards at their longest (500 and 2,000
 * characters) are about 2 MB, and the web container has 512 MB. A deck this
 * call created that took no card, because the learner's decks are full, is
 * deleted again: it would stand empty and count as one of their 100.
 */
import type { Route } from "./+types/mastery.decks.import";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addDeckCards, createDeck, deleteDeck, DECK_BATCH, type DeckCard } from "~/lib/decks.server";
import { BodyTooLargeError, readTextLimited } from "~/lib/tools/bounded-read.server";

const MAX_BODY_BYTES = 3 * 1024 * 1024;

type Body = { deck_id?: string; name?: string; source?: string; cards?: DeckCard[] };

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  let body: Body;
  try {
    body = JSON.parse(await readTextLimited(request.body, MAX_BODY_BYTES)) as Body;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return Response.json({ error: "request body too large" }, { status: 413 });
    return Response.json({ error: "malformed request body" }, { status: 400 });
  }
  const cards = Array.isArray(body.cards) ? body.cards.slice(0, DECK_BATCH) : [];
  try {
    let deckId = body.deck_id ?? "";
    const created = !deckId;
    if (created) {
      const deck = await createDeck(user.id, { name: String(body.name ?? "").slice(0, 200), source: String(body.source ?? "").slice(0, 500) });
      deckId = deck.id;
    }
    const result = await addDeckCards(user.id, deckId, cards);
    if (created && result.created === 0 && (result.over_limit ?? 0) > 0) {
      await deleteDeck(user.id, deckId);
      return Response.json({ deck_id: "", ...result });
    }
    return Response.json({ deck_id: deckId, ...result });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    return Response.json({ error: error instanceof ApiError ? error.message : "could not add the cards" }, { status });
  }
}
