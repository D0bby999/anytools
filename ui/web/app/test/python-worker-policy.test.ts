/**
 * python-worker-policy.test.ts
 * server.mjs gives the Python worker's script its own Content-Security-
 * Policy (no eval; scripts and fetches only from /assets/ and /tool-
 * runtime/), found by the worker chunk's file name. A renamed worker would
 * lose it without a word: this holds the two together. The policy itself was
 * checked in a browser on the production build (js.eval, Function,
 * loadPackage to another site and to an app page, FontFace: all refused).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = process.cwd();

describe("the Python worker's policy", () => {
  it("is set for the worker Vite builds from app/workers/python.worker.ts", () => {
    expect(existsSync(join(WEB, "app/workers/python.worker.ts"))).toBe(true);
    const runner = readFileSync(join(WEB, "app/lib/python-runner.ts"), "utf8");
    expect(runner).toContain('new URL("../workers/python.worker.ts", import.meta.url)');
    const server = readFileSync(join(WEB, "server.mjs"), "utf8");
    const pattern = /const PYTHON_WORKER = \/(.+)\/;/.exec(server)?.[1];
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test("/python.worker-B_r9bdCU.js")).toBe(true);
    expect(server).toContain("default-src 'none'; script-src ${origin}/assets/ ${origin}/tool-runtime/ 'wasm-unsafe-eval'; connect-src ${origin}/tool-runtime/");
    expect(server).not.toContain("'unsafe-eval'");
  });
});
