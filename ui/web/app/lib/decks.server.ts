/**
 * decks.server.ts
 * The general decks' API module (plans/261020-1535-beyond-english-learning-
 * areas, phase 5). Server-side only; every call is scoped by the user id.
 */
import { apiFetch } from "~/lib/api.server";
import { LIBRARY, LICENCE_TEXT, librarySource } from "~/lib/deck-library";

export type Deck = {
  id: string;
  name: string;
  source: string;
  licence: string;
  source_url: string;
  created_at: string;
  cards: number;
  due: number;
  new: number;
  last_new?: string;
};

export type DeckCard = { front: string; back: string };
export type AddResult = { created: number; duplicates: number; invalid: number; first_day?: string; last_day?: string };

/** The API's largest batch: vocab.MaxImportBatch. */
export const DECK_BATCH = 200;

export function listDecks(userId: string) {
  return apiFetch<{ decks: Deck[] }>("/v1/decks", userId);
}

export function createDeck(userId: string, body: { name: string; source?: string; licence?: string; source_url?: string }) {
  return apiFetch<Deck>("/v1/decks", userId, { method: "POST", body });
}

export function deleteDeck(userId: string, id: string) {
  return apiFetch<void>(`/v1/decks/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

export function addDeckCards(userId: string, id: string, cards: DeckCard[]) {
  return apiFetch<AddResult>(`/v1/decks/${encodeURIComponent(id)}/cards`, userId, { method: "POST", body: { cards } });
}

/** A bundled library deck's text, loaded only when it is added. */
const BUNDLED: Record<string, () => Promise<{ default: { name: string; cards: DeckCard[] } }>> = {
  "ultimate-geography-en": () => import("~/data/decks/ultimate-geography-en.json"),
  "ultimate-geography-es": () => import("~/data/decks/ultimate-geography-es.json"),
  "ultimate-geography-pt": () => import("~/data/decks/ultimate-geography-pt.json"),
};

/** Adds a bundled library deck: the deck, then its cards in batches. */
export async function addLibraryDeck(userId: string, slug: string) {
  const entry = LIBRARY.find((d) => d.slug === slug && d.bundled);
  const load = BUNDLED[slug];
  if (!entry || !load) return null;
  const { default: data } = await load();
  const deck = await createDeck(userId, {
    name: `${data.name} (${entry.language.toUpperCase()})`,
    source: librarySource(slug),
    licence: LICENCE_TEXT[entry.licence],
    source_url: entry.sourceUrl,
  });
  const totals: AddResult = { created: 0, duplicates: 0, invalid: 0 };
  for (let i = 0; i < data.cards.length; i += DECK_BATCH) {
    const r = await addDeckCards(userId, deck.id, data.cards.slice(i, i + DECK_BATCH));
    totals.created += r.created;
    totals.duplicates += r.duplicates;
    totals.invalid += r.invalid;
    totals.first_day ??= r.first_day;
    totals.last_day = r.last_day ?? totals.last_day;
  }
  return { deck, totals };
}
