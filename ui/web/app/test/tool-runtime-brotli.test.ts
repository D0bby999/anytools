/**
 * tool-runtime-brotli.test.ts
 * A run-time file staged with a brotli copy beside it is sent as that copy
 * to a browser that accepts br, and as itself otherwise; either way the
 * response says the file's own size (X-File-Size), which Python's loader
 * shows progress against. The copy is never served by its own name.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptsBrotli, runtimeFile } from "~/lib/tools/runtime-files.server";

let root = "";
const wasm = Buffer.alloc(200_000, "abc");
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "runtime-"));
  await mkdir(join(root, "pyodide@1.0.0"));
  await writeFile(join(root, "pyodide@1.0.0/python.wasm"), wasm);
  await writeFile(join(root, "pyodide@1.0.0/python.wasm.br"), brotliCompressSync(wasm));
  await writeFile(join(root, "pyodide@1.0.0/plain.json"), "{}");
  await writeFile(join(root, "pyodide@1.0.0/flag.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

const bytes = async (res: Response | null) => Buffer.from(await res!.arrayBuffer());

describe("a run-time file with a brotli copy", () => {
  it("reads Accept-Encoding", () => {
    expect(acceptsBrotli("gzip, deflate, br, zstd")).toBe(true);
    expect(acceptsBrotli("br;q=0.5")).toBe(true);
    expect(acceptsBrotli("gzip, br;q=0")).toBe(false);
    expect(acceptsBrotli("gzip")).toBe(false);
    expect(acceptsBrotli(null)).toBe(false);
  });

  it("is sent compressed to a browser that takes br, saying the file's own size", async () => {
    const res = await runtimeFile(root, "pyodide@1.0.0/python.wasm", "gzip, br");
    expect(res?.headers.get("Content-Encoding")).toBe("br");
    expect(res?.headers.get("Vary")).toBe("Accept-Encoding");
    expect(res?.headers.get("X-File-Size")).toBe(String(wasm.length));
    const body = await bytes(res);
    expect(Number(res?.headers.get("Content-Length"))).toBe(body.length);
    expect(brotliDecompressSync(body).equals(wasm)).toBe(true);
  });

  it("is sent as itself otherwise", async () => {
    const res = await runtimeFile(root, "pyodide@1.0.0/python.wasm", "gzip");
    expect(res?.headers.get("Content-Encoding")).toBeNull();
    expect(res?.headers.get("Content-Length")).toBe(String(wasm.length));
    expect((await bytes(res)).equals(wasm)).toBe(true);
  });

  it("leaves a file without a copy alone, and never serves a copy by its name", async () => {
    const res = await runtimeFile(root, "pyodide@1.0.0/plain.json", "br");
    expect(res?.headers.get("Content-Encoding")).toBeNull();
    expect(res?.headers.get("Vary")).toBeNull();
    await res?.body?.cancel();
    expect(await runtimeFile(root, "pyodide@1.0.0/python.wasm.br", "br")).toBeNull();
  });

  it("sends an SVG sandboxed, so one opened directly runs nothing as the app", async () => {
    const res = await runtimeFile(root, "pyodide@1.0.0/flag.svg");
    expect(res?.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res?.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    await res?.body?.cancel();
    const json = await runtimeFile(root, "pyodide@1.0.0/plain.json");
    expect(json?.headers.get("Content-Security-Policy")).toBeNull();
    await json?.body?.cancel();
  });

  it("opens no file for a HEAD, whose body is never read", async () => {
    const res = await runtimeFile(root, "pyodide@1.0.0/python.wasm", "br", "HEAD");
    expect(res?.status).toBe(200);
    expect(res?.body).toBeNull();
    expect(res?.headers.get("X-File-Size")).toBe(String(wasm.length));
  });
});
