/**
 * tools-server-routes.test.ts
 * AnyTools phase 3a: the two public routes a tool calls on this server.
 *
 *  - POST /api/curl-convert runs the real curlconverter, on the wasm parser
 *    the server build uses (checked: that parser is the one that parses).
 *  - GET /api/fx calls Frankfurter, here a recorded answer behind a stubbed
 *    fetch: no live call is made.
 *
 * Both keep the old site's answers and limits, and add a capped body read and
 * a per-address budget.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchRoutes, type RouteObject } from "react-router";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routeConfig from "~/routes";

vi.stubEnv("ANYTOOLS_APP_URL", "https://anytools.example");
vi.stubEnv("ANYTOOLS_SESSION_SECRET", "test-session-secret-value");
vi.stubEnv("ANYTOOLS_GATEWAY_TOKEN", "test-gateway-token");

const curlRoute = await import("~/routes/api.curl-convert");
const { default: wasmParser } = await import("~/lib/tools/curl-parser.server");
const fxRoute = await import("~/routes/api.fx");
const { TOOL_BUDGETS, __resetToolBudgetsForTests } = await import("~/lib/tools/public-budget.server");
const { FRANKFURTER_LATEST, FX_TTL_MS, __clearFxCacheForTests, fxRates } = await import("~/lib/tools/fx.server");

const SITE = "https://anytools.example";
let ip = 0;
/** A fresh client address per test, so one test's budget never leaks into the next. */
let address = "";
beforeEach(() => {
  ip += 1;
  address = `203.0.113.${ip}`;
  __resetToolBudgetsForTests();
});

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  const request = new Request(`${SITE}/api/curl-convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "X-Forwarded-For": address, ...headers },
    body,
  });
  return curlRoute.action({ request, params: {}, context: {} } as never) as Promise<Response>;
}

const convert = (curl: unknown, target: unknown) => post(JSON.stringify({ curl, target }));

async function json(res: Response) {
  return (await res.json()) as { code?: string; error?: string };
}

describe("POST /api/curl-convert", () => {
  it("converts a command for each of the five targets", async () => {
    const curl = "curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{\"a\":1}'";
    const expected: Record<string, RegExp> = {
      fetch: /fetch\('https:\/\/api\.example\.com\/items'/,
      "node-fetch": /import fetch from 'node-fetch'/,
      python: /requests\.post\('https:\/\/api\.example\.com\/items'/,
      php: /curl_setopt|\$ch|Requests::post|GuzzleHttp/,
      go: /http\.NewRequest\("POST", "https:\/\/api\.example\.com\/items"/,
    };
    for (const [target, pattern] of Object.entries(expected)) {
      const res = await convert(curl, target);
      expect(res.status, target).toBe(200);
      expect((await json(res)).code, target).toMatch(pattern);
    }
  });

  it("parses on the wasm parser, never curlconverter's native one", async () => {
    const parse = vi.spyOn(wasmParser, "parse");
    try {
      expect((await convert("curl https://a.example", "python")).status).toBe(200);
      expect(parse).toHaveBeenCalledWith("curl https://a.example");
    } finally {
      parse.mockRestore();
    }
  });

  it("answers 422 with curlconverter's own message for what it cannot parse", async () => {
    const res = await convert("ls -la", "python");
    expect(res.status).toBe(422);
    expect((await json(res)).error).toBeTruthy();
  });

  it("keeps the old route's 400s and 413", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await convert("", "python")).status).toBe(400);
    expect((await convert("   ", "python")).status).toBe(400);
    expect((await convert(42, "python")).status).toBe(400);
    expect((await convert("curl https://a.example", "ruby")).status).toBe(400);
    expect((await json(await convert("curl https://a.example", undefined))).error).toBe("Invalid target");
    const long = await convert(`curl https://a.example/${"a".repeat(8000)}`, "python");
    expect(long.status).toBe(413);
    expect((await json(long)).error).toBe("curl too long (max 8000 chars)");
  });

  it("stops reading a body past 64 KiB, before parsing it", async () => {
    const res = await post(JSON.stringify({ curl: "curl https://a.example", target: "go", pad: "x".repeat(70 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("refuses a cross-site POST before doing anything", async () => {
    await expect(post(JSON.stringify({ curl: "curl https://a.example", target: "go" }), { Origin: "https://evil.example" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("gives each address a budget, and answers past it in JSON the tool can show", async () => {
    const { burst } = TOOL_BUDGETS["curl-convert"];
    for (let i = 0; i < burst; i++) expect((await convert("curl https://a.example", "go")).status).toBe(200);
    const over = await convert("curl https://a.example", "go");
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("60");
    expect((await json(over)).error).toMatch(/Too many requests/);
    // Another address still has its own.
    address = "198.51.100.7";
    expect((await convert("curl https://a.example", "go")).status).toBe(200);
  });
});

// Recorded from Frankfurter on 2026-10-18 (https://api.frankfurter.dev/v1/latest?from=USD).
const RECORDED = readFileSync(resolve(process.cwd(), "app/test/fixtures/frankfurter-latest-usd.json"), "utf8");

describe("GET /api/fx", () => {
  const upstream = vi.fn<typeof fetch>();
  beforeEach(() => {
    __clearFxCacheForTests();
    upstream.mockReset();
    upstream.mockImplementation(async () => new Response(RECORDED, { status: 200 }));
    vi.stubGlobal("fetch", upstream);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const get = (query: string) =>
    fxRoute.loader({
      request: new Request(`${SITE}/api/fx${query}`, { headers: { "X-Forwarded-For": address } }),
      params: {},
      context: {},
    } as never) as Promise<Response>;

  it("answers the day's rates, cacheable for a day, from Frankfurter's current address", async () => {
    const res = await get("?base=usd");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=86400, stale-while-revalidate=43200");
    const body = (await res.json()) as { base: string; date: string; rates: Record<string, number> };
    expect(body.base).toBe("USD");
    expect(body.date).toBe("2026-10-16");
    expect(body.rates.EUR).toBeCloseTo(0.88865);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(`${FRANKFURTER_LATEST}?from=USD`);
    expect(init).toMatchObject({ redirect: "error" });
  });

  it("defaults to USD, as before", async () => {
    expect((await get("")).status).toBe(200);
    expect(upstream.mock.calls[0]?.[0]).toBe(`${FRANKFURTER_LATEST}?from=USD`);
  });

  it("asks Frankfurter once a day per base", async () => {
    await get("?base=EUR");
    await get("?base=EUR");
    expect(upstream).toHaveBeenCalledTimes(1);
    let t = 1_000;
    await fxRates("GBP", upstream, () => t);
    t += FX_TTL_MS - 1;
    await fxRates("GBP", upstream, () => t);
    expect(upstream).toHaveBeenCalledTimes(2);
    t += 2;
    await fxRates("GBP", upstream, () => t);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("refuses anything but a three-letter code, without calling out", async () => {
    for (const q of ["?base=US", "?base=USDX", "?base=U%2FD", "?base=../x", "?base=12A"]) {
      const res = await get(q);
      expect(res.status, q).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 503 when Frankfurter fails, sends too much, or sends something else", async () => {
    upstream.mockImplementationOnce(async () => new Response('{"message":"not found"}', { status: 404 }));
    expect((await get("?base=ZZZ")).status).toBe(503);
    upstream.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await get("?base=JPY")).status).toBe(503);
    // A real answer, padded past the 64 KiB read cap: refused for its size alone.
    upstream.mockImplementationOnce(async () => new Response(RECORDED + " ".repeat(70 * 1024), { status: 200 }));
    expect((await get("?base=JPY")).status).toBe(503);
    upstream.mockImplementationOnce(async () => new Response('{"base":"JPY","date":"2026-10-16","rates":{"EUR":"<b>"}}'));
    expect((await get("?base=JPY")).status).toBe(503);
    upstream.mockImplementationOnce(async () => new Response("<html>moved</html>"));
    expect((await get("?base=JPY")).status).toBe(503);
  });

  it("keeps serving yesterday's rates when today's call fails", async () => {
    let t = 0;
    await fxRates("CHF", upstream, () => t);
    t += FX_TTL_MS + 1;
    upstream.mockImplementationOnce(async () => new Response("", { status: 500 }));
    expect((await fxRates("CHF", upstream, () => t))?.base).toBe("USD");
  });

  it("gives each address a budget", async () => {
    const { burst } = TOOL_BUDGETS.fx;
    for (let i = 0; i < burst; i++) expect((await get("?base=USD")).status).toBe(200);
    const over = await get("?base=USD");
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toMatch(/Too many requests/);
  });
});

describe("budget markers", () => {
  it("every route that spends a tool budget names it in routes.ts, and only those", () => {
    const routes = readFileSync(resolve(process.cwd(), "app/routes.ts"), "utf8");
    const marked = [...routes.matchAll(/\/\/ budget: ([a-z-]+)/g)].map((m) => m[1]).sort();
    expect(marked).toEqual(Object.keys(TOOL_BUDGETS).sort());
    for (const [file, name] of [
      ["app/routes/api.curl-convert.ts", "curl-convert"],
      ["app/routes/api.fx.ts", "fx"],
    ] as const) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8")).toContain(`overToolBudget("${name}"`);
      expect(routes).toMatch(new RegExp(`"${file.replace("app/", "")}"\\), // budget: ${name}\\n`));
    }
  });
});

describe("route matching", () => {
  // routes.ts as React Router's matcher sees it, ranking included.
  const toObjects = (entries: RouteConfigEntry[]): RouteObject[] =>
    entries.map((e) =>
      e.index
        ? { id: e.file, index: true }
        : { id: e.file, path: e.path, children: e.children ? toObjects(e.children) : undefined },
    );
  const routes = toObjects(routeConfig);
  const leaf = (path: string) => matchRoutes(routes, path)?.at(-1)?.route.id;

  it("sends each URL to its route, a run-time file's three segments included", () => {
    expect(leaf("/tool-runtime/libarchive.js@2.0.2/worker-bundle.js")).toBe("routes/tool-runtime.$.ts");
    expect(leaf("/tool-runtime/libarchive.js@2.0.2/libarchive.wasm")).toBe("routes/tool-runtime.$.ts");
    expect(leaf("/tool-runtime/pdfjs@5.4.149/cmaps/Adobe-CNS1-0.bcmap")).toBe("routes/tool-runtime.$.ts");
    expect(leaf("/api/curl-convert")).toBe("routes/api.curl-convert.ts");
    expect(leaf("/api/fx")).toBe("routes/api.fx.ts");
    expect(leaf("/en/converters/curl-converter")).toBe("routes/public.tool.tsx");
    expect(leaf("/vi/finance")).toBe("routes/public.cluster.tsx");
    expect(leaf("/en/converters/curl-converter/og.png")).toBe("routes/public.tool-og.ts");
  });
});
