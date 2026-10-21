// @vitest-environment node
/**
 * tool-runtime.test.ts
 * AnyTools phase 3c: the files tools fetch by URL at run time (wasm, models,
 * language data, fonts) come from this origin, under a URL that changes when
 * the file does.
 *
 *  - Every URL in tools/shared/tool-runtime.ts names a file or folder that
 *    scripts/tool-runtime.json stages, and the route serves it.
 *  - A package's folder carries the installed version, so the year-long
 *    immutable cache can never hold a stale file under a current URL.
 *  - No tool source names a public CDN or the old site's /third-party/ paths.
 *    tesseract.js, zxing-wasm, onnxruntime-web and Excalidraw all default to a
 *    CDN when not given a path; the right fix is always a tool-runtime URL.
 *
 * The staged folder is gitignored; `pnpm build` (or `pnpm dev`) stages it,
 * and CI builds before it tests.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoutes, type RouteObject } from "react-router";
import routes from "~/routes";
import * as runtime from "~/tools/shared/tool-runtime";
import { RUNTIME_ROOT, runtimeFile } from "~/lib/tools/runtime-files.server";

type Entry = {
  package?: string;
  via?: string;
  copy?: { from: string; to: string }[];
  download?: { url: string; sha256: string; to: string }[];
};

const WEB = resolve(process.cwd());
const manifest = JSON.parse(readFileSync(join(WEB, "scripts/tool-runtime.json"), "utf8")) as Record<string, Entry>;
const urls = Object.entries(runtime).filter(([, v]) => typeof v === "string") as [string, string][];

function packageRoot(name: string, from: string): string {
  let dir = dirname(createRequire(join(from, "package.json")).resolve(name));
  while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name) {
    dir = dirname(dir);
  }
  return dir;
}

function installedRoot(entry: Entry): string {
  const from = entry.via ? realpathSync(packageRoot(entry.via, WEB)) : WEB;
  return packageRoot(entry.package ?? "", from);
}

/** What a folder stages, as paths inside it. */
const stagedPaths = (entry: Entry) => [...(entry.copy ?? []).map((c) => c.to), ...(entry.download ?? []).map((d) => d.to)];

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

describe("the run-time URLs", () => {
  it.each(urls)("%s names something the manifest stages", (_, url) => {
    const m = /^\/tool-runtime\/([^/]+)\/(.*)$/.exec(url);
    expect(m, url).not.toBeNull();
    const [, dir = "", rest = ""] = m ?? [];
    const entry = manifest[dir];
    expect(entry, `${dir} is not in scripts/tool-runtime.json`).toBeDefined();
    if (rest === "") return;
    expect(stagedPaths(entry ?? {}).some((p) => rest === p || rest.startsWith(`${p}/`))).toBe(true);
  });

  it.each(Object.entries(manifest).filter(([, e]) => e.package))("%s carries the installed version", (dir, entry) => {
    const root = installedRoot(entry);
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
    expect(dir).toBe(`${entry.package?.replace(/^@/, "").replace("/", "-")}@${version}`);
    for (const { from } of entry.copy ?? []) expect(existsSync(join(root, from)), `${entry.package}/${from}`).toBe(true);
  });

  it("downloads only from immutable URLs, each with a pinned sha256", () => {
    for (const entry of Object.values(manifest)) {
      for (const d of entry.download ?? []) {
        expect(d.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(raw\/([0-9a-f]{40}|\d[\w.]*)\/|releases\/download\/v[\w.]+\/|archive\/[0-9a-f]{40}\.zip$)/);
        expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

describe("the route", () => {
  type Config = { path?: string; index?: boolean; file: string; children?: Config[] };
  const objects = (rs: Config[]): RouteObject[] =>
    rs.map((r) => ({ path: r.path, index: r.index, id: r.file, children: r.children ? objects(r.children) : undefined }) as RouteObject);
  const leaf = (url: string) => matchRoutes(objects(routes as Config[]), url)?.at(-1)?.route.id;

  // A file directly in its folder makes a three-segment URL, which `:locale/:cluster/:tool`
  // outranks a bare `tool-runtime/*` for; the public tool page then answers 404.
  it.each(urls.map(([name, url]) => [name, url.endsWith("/") ? `${url}x.wasm` : url]))("%s reaches it", (_, url) => {
    expect(leaf(url)).toBe("routes/tool-runtime.$.ts");
  });

  it("hands the loader the whole path, folder included", async () => {
    const { loader } = await import("~/routes/tool-runtime.$");
    const res = (await loader({ params: { pkg: "u2netp@0.0.0", "*": "u2netp.onnx" }, request: new Request("http://localhost/tool-runtime/u2netp@0.0.0/u2netp.onnx") } as never)) as Response;
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });

  it("and the tool pages still reach theirs", () => {
    expect(leaf("/en/pdf/merge-pdf")).toBe("routes/public.tool.tsx");
    expect(leaf("/en/pdf/merge-pdf/og.png")).toBe("routes/public.tool-og.ts");
  });
});

describe("the staged folder", () => {
  it("holds every folder the manifest names (run `pnpm build` or scripts/stage-tool-runtime.mjs)", () => {
    const missing = Object.keys(manifest).filter((dir) => !existsSync(join(RUNTIME_ROOT, dir)));
    expect(missing).toEqual([]);
  });

  it.each(urls.filter(([, u]) => !u.endsWith("/")))("serves %s", async (_, url) => {
    const res = await runtimeFile(RUNTIME_ROOT, url.replace(/^\/tool-runtime\//, ""));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Cache-Control")).toContain("immutable");
    await res?.body?.cancel();
  });

  it("serves every staged file but licence texts, so no library fetch 404s on a type", async () => {
    // A .br file is a brotli copy, sent in place of the file it is beside.
    const files = walk(RUNTIME_ROOT, (p) => !/\/(\.gitkeep|LICENSE[^/.]*)$/.test(p) && !p.endsWith(".br"));
    expect(files.length).toBeGreaterThan(0);
    const refused: string[] = [];
    for (const f of files) {
      const res = await runtimeFile(RUNTIME_ROOT, f.slice(RUNTIME_ROOT.length + 1));
      if (res?.status !== 200) refused.push(f.slice(RUNTIME_ROOT.length + 1));
      await res?.body?.cancel();
    }
    expect(refused).toEqual([]);
  });
});

describe("no tool reaches past this origin for its run-time files", () => {
  const CDN = /(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|huggingface\.co|cdnjs\.cloudflare\.com|cdn\.sheetjs\.com|raw\.githubusercontent\.com)/;
  const sources = [join(WEB, "app/tools"), join(WEB, "app/lib/tools")].flatMap((d) =>
    walk(d, (p) => /\.(ts|tsx|mjs|js|json|css)$/.test(p) && !/\.test\.tsx?$/.test(p)),
  );

  it("names no public CDN", () => {
    expect(sources.filter((f) => CDN.test(readFileSync(f, "utf8"))).map((f) => f.slice(WEB.length + 1))).toEqual([]);
  });

  it("names none of the old site's /third-party/ paths", () => {
    expect(
      sources.filter((f) => /["'`]\/third-party\//.test(readFileSync(f, "utf8"))).map((f) => f.slice(WEB.length + 1)),
    ).toEqual([]);
  });
});
