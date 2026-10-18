/**
 * tools-batch-b.test.ts
 * AnyTools phase 3b: what porting the encoding, formatters, generators and
 * text-regex tools added beyond their own old tests.
 *
 *  - The wasm three of them load by URL is served from this origin, and is the
 *    very file the installed package ships, at the version in its path.
 *  - json-schema-validator runs ajv in a worker (the page's CSP has no
 *    'unsafe-eval'), and the worker's answers come back to the right call.
 *  - None of the 43 tools sends anything off the page.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_ROOT, runtimeFile } from "~/lib/tools/runtime-files.server";
import { toolMetas } from "~/tools/meta-registry";
import { JQ_WASM_URL } from "~/tools/jq-playground/logic";
import { SQLJS_WASM_BASE } from "~/tools/sql-playground/logic";
import { WASM_URL as ZXING_WASM_URL } from "~/tools/shared/zxing-loader";
import { ToolError } from "~/tools/shared/tool-error";
import { answer, reviveError, type ValidateRequest } from "~/tools/json-schema-validator/validator-protocol";
import { createSchemaValidator } from "~/tools/json-schema-validator/validator-client";

const WEB = process.cwd();
const TOOLS = resolve(WEB, "app/tools");
const BATCH_B = toolMetas
  .filter((m) => ["encoding", "formatters", "generators", "text-regex"].includes(m.cluster))
  .map((m) => m.slug)
  .sort();

describe("the run-time files batch B loads by URL", () => {
  const files = [
    { url: JQ_WASM_URL, pkg: "jq-wasm", inPackage: "dist/build/jq.wasm" },
    { url: `${SQLJS_WASM_BASE}sql-wasm-browser.wasm`, pkg: "sql.js", inPackage: "dist/sql-wasm-browser.wasm" },
    { url: ZXING_WASM_URL, pkg: "zxing-wasm", inPackage: "dist/full/zxing_full.wasm" },
  ];

  it.each(files)("$url is the installed $pkg's own file, at its version", async ({ url, pkg, inPackage }) => {
    const installed = JSON.parse(readFileSync(join(WEB, "node_modules", pkg, "package.json"), "utf8")) as {
      version: string;
    };
    expect(url).toBe(`/tool-runtime/${pkg}@${installed.version}/${inPackage.split("/").pop()}`);

    const served = await runtimeFile(RUNTIME_ROOT, url.replace(/^\/tool-runtime\//, ""));
    expect(served?.status).toBe(200);
    expect(served?.headers.get("Content-Type")).toBe("application/wasm");
    expect(served?.headers.get("Cache-Control")).toContain("immutable");
    const bytes = Buffer.from(await (served as Response).arrayBuffer());
    expect(bytes.equals(readFileSync(join(WEB, "node_modules", pkg, inPackage)))).toBe(true);
  });

  it("sql.js in the browser asks for the file that is there", () => {
    // The browser build names its own binary; locateFile only adds the base.
    const glue = readFileSync(join(WEB, "node_modules/sql.js/dist/sql-wasm-browser.js"), "utf8");
    expect(glue).toContain("sql-wasm-browser.wasm");
  });
});

describe("json-schema-validator's worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (id: number, schema: unknown, data: unknown): ValidateRequest => ({
    id,
    schemaText: JSON.stringify(schema),
    dataText: JSON.stringify(data),
    draft: "draft-07",
  });

  it("answers with the result, or with the ToolError's code and params", async () => {
    expect(await answer(request(1, { type: "integer" }, 3))).toEqual({ id: 1, ok: true, result: { valid: true } });
    const bad = await answer({ ...request(2, {}, 1), schemaText: "{" });
    expect(bad).toMatchObject({ id: 2, ok: false, error: { code: "invalidSchemaJson" } });
    if (bad.ok) throw new Error("expected an error");
    const revived = reviveError(bad.error);
    expect(revived).toBeInstanceOf(ToolError);
    expect((revived as ToolError).code).toBe("invalidSchemaJson");
    expect((revived as ToolError).params).toEqual(bad.error.params);
  });

  it("the page validates through the worker, and an older answer resolves only its own call", async () => {
    const posted: ValidateRequest[] = [];
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      terminated = false;
      constructor(readonly url: URL, readonly options?: WorkerOptions) {
        workers.push(this);
      }
      postMessage(r: ValidateRequest) {
        posted.push(r);
      }
      terminate() {
        this.terminated = true;
      }
      async reply(r: ValidateRequest) {
        this.onmessage?.({ data: await answer(r) } as MessageEvent);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);

    const v = createSchemaValidator();
    const first = v.validate(JSON.stringify({ type: "string" }), "1", "draft-07");
    const second = v.validate(JSON.stringify({ type: "integer" }), "1", "draft-07");
    expect(workers).toHaveLength(1);
    expect(String(workers[0]?.url)).toMatch(/\/validator-worker\.ts(\?|$)/);
    expect(workers[0]?.options).toEqual({ type: "module" });

    const [r1, r2] = posted;
    await workers[0]?.reply(r2 as ValidateRequest);
    await workers[0]?.reply(r1 as ValidateRequest);
    expect(await second).toEqual({ valid: true });
    expect(await first).toMatchObject({ valid: false });

    v.dispose();
    expect(workers[0]?.terminated).toBe(true);
  });

  it("falls back to the page when the worker cannot start", async () => {
    class DeadWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onerror?.(new Event("error")));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", DeadWorker);
    const v = createSchemaValidator();
    expect(await v.validate(JSON.stringify({ type: "integer" }), "1", "draft-07")).toEqual({ valid: true });
  });

  it("the tool's UI goes through the worker client, never ajv or validateAgainstSchema", () => {
    const ui = readFileSync(join(TOOLS, "json-schema-validator/ui.tsx"), "utf8");
    expect(ui).toContain("from './validator-client'");
    expect(ui).not.toMatch(/validateAgainstSchema|['"]ajv/);
  });
});

describe("batch B sends nothing off the page", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : [];
    });
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const NETWORK = /\bfetch\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|sendBeacon|importScripts/;

  it("covers all 43", () => {
    expect(BATCH_B).toHaveLength(43);
  });

  it.each(BATCH_B)("%s", (slug) => {
    const offenders = walk(join(TOOLS, slug)).flatMap((p) =>
      code(readFileSync(p, "utf8"))
        .split("\n")
        .filter((line) => NETWORK.test(line))
        .map((line) => `${slug}/${p.split("/").pop()}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
