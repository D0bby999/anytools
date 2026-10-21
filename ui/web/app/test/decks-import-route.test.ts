/**
 * decks-import-route.test.ts
 * The deck importer's resource route: a body is read up to 3 MB and refused
 * past it, whatever it claims; a deck this call created that took no card,
 * because the learner's decks are full, is deleted again (independent
 * review, M8 and M9).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth.server", () => ({ requireUser: async () => ({ user: { id: "u1" } }) }));
const calls: string[] = [];
let added = { created: 2, duplicates: 0, invalid: 0, over_limit: 0 };
vi.mock("~/lib/decks.server", () => ({
  DECK_BATCH: 200,
  createDeck: async () => (calls.push("create"), { id: "d1" }),
  addDeckCards: async () => (calls.push("add"), added),
  deleteDeck: async (_u: string, id: string) => void calls.push(`delete ${id}`),
}));

const { action } = await import("~/routes/mastery.decks.import");
const post = (body: string) => action({ request: new Request("http://x/mastery/decks/import", { method: "POST", body }) } as never) as Promise<Response>;

beforeEach(() => {
  calls.length = 0;
  added = { created: 2, duplicates: 0, invalid: 0, over_limit: 0 };
});

describe("the deck importer's route", () => {
  it("refuses a body past 3 MB without adding anything", async () => {
    const res = await post(JSON.stringify({ name: "Big", cards: [{ front: "x".repeat(4 * 1024 * 1024), back: "y" }] }));
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("creates the deck on the first batch and adds to it", async () => {
    const res = await post(JSON.stringify({ name: "Geo", cards: [{ front: "a", back: "b" }] }));
    expect(await res.json()).toMatchObject({ deck_id: "d1", created: 2 });
    expect(calls).toEqual(["create", "add"]);
  });

  it("deletes a deck it created when the learner's decks are full", async () => {
    added = { created: 0, duplicates: 0, invalid: 0, over_limit: 1 };
    const res = await post(JSON.stringify({ name: "Geo", cards: [{ front: "a", back: "b" }] }));
    expect(await res.json()).toMatchObject({ deck_id: "", over_limit: 1 });
    expect(calls).toEqual(["create", "add", "delete d1"]);
  });

  it("keeps a deck an earlier batch created", async () => {
    added = { created: 0, duplicates: 0, invalid: 0, over_limit: 1 };
    await post(JSON.stringify({ deck_id: "d0", cards: [{ front: "a", back: "b" }] }));
    expect(calls).toEqual(["add"]);
  });
});
