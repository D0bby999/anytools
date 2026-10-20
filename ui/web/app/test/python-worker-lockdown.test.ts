/**
 * python-worker-lockdown.test.ts
 * The Python worker cuts itself off before an exercise runs (plans/
 * 261020-1535-beyond-english-learning-areas, phase 4): an exercise written
 * from an untrusted document must not reach the app's routes with the
 * learner's session, nor the offline cache. The cut covers the global and
 * every prototype behind it, as fetch and the storage getters live there too.
 */
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("self", globalThis);
const { lockDown } = await import("~/workers/python.worker");

describe("lockDown", () => {
  it("removes network, storage and other contexts from the global and its prototypes", () => {
    const proto = {
      fetch: () => "fetched",
      get caches() {
        return "cache storage";
      },
      postMessage: () => "kept",
    };
    Object.defineProperty(proto, "indexedDB", { get: () => "idb", configurable: true });
    const scope = Object.create(proto) as Record<string, unknown>;
    scope.XMLHttpRequest = class {};
    scope.Worker = class {};
    lockDown(scope);
    for (const name of ["fetch", "caches", "indexedDB", "XMLHttpRequest", "Worker"]) {
      expect(scope[name]).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(proto, name)).toBeUndefined();
    }
    expect((proto.postMessage as () => string)()).toBe("kept");
  });
});
