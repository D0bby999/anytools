/**
 * turns.test.ts
 *
 * Two small guards that each close a real finding from the phase 6 review:
 * the client never re-attached to a live turn after a reload (so "refresh
 * mid-stream resumes" was never implemented), and route params went into API
 * paths unvalidated.
 */
import { describe, expect, it } from "vitest";
import { isLiveStatus, isUUID, liveTurnID, requireUUID } from "~/lib/turns";

const TURN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("liveTurnID", () => {
  it("finds the non-terminal turn to re-attach to after a reload", () => {
    // The API returns turns newest-first.
    expect(
      liveTurnID([
        { id: TURN, status: "running" },
        { id: OTHER, status: "done" },
      ]),
    ).toBe(TURN);
  });

  it("treats queued and waiting_user as live too", () => {
    expect(liveTurnID([{ id: TURN, status: "queued" }])).toBe(TURN);
    expect(liveTurnID([{ id: TURN, status: "waiting_user" }])).toBe(TURN);
  });

  it("returns null when everything has finished", () => {
    expect(
      liveTurnID([
        { id: TURN, status: "done" },
        { id: OTHER, status: "failed" },
      ]),
    ).toBeNull();
    expect(liveTurnID([{ id: TURN, status: "cancelled" }])).toBeNull();
    expect(liveTurnID([])).toBeNull();
  });

  it("does not treat an unknown status as live", () => {
    // A status this client has never heard of is not something to attach a
    // stream to; the server would answer, and the UI would wait forever.
    expect(isLiveStatus("something_new")).toBe(false);
  });
});

describe("requireUUID", () => {
  it("accepts a uuid in either case", () => {
    expect(isUUID(TURN)).toBe(true);
    expect(isUUID(TURN.toUpperCase())).toBe(true);
    expect(requireUUID(TURN)).toBe(TURN);
  });

  /**
   * React Router decodes %2F before a loader sees a param, so these reach the
   * route as real path segments. Interpolated into an API path they would be
   * normalised by fetch into a request for a DIFFERENT internal endpoint,
   * carrying this server's gateway token.
   */
  it("refuses anything that could traverse a path", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "../../v1/me",
      `${TURN}/../../me`,
      `..%2F..%2Fme`,
      `${TURN}?x=1`,
      `${TURN} `,
      "11111111-1111-1111-1111-11111111111", // one short
    ]) {
      expect(isUUID(bad), bad).toBe(false);
      let thrown: unknown;
      try {
        requireUUID(bad);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, bad).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(404);
    }
  });
});
