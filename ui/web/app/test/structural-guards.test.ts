/**
 * structural-guards.test.ts
 *
 * Tests about the SHAPE of the codebase rather than any one behavior. Each one
 * pins an invariant that is easy to violate accidentally and expensive to
 * discover late — the class of guard postclaw found worth keeping (scout §10).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// vitest runs with ui/web as the working directory (vitest.config.ts lives
// there), so the app tree is resolved from it rather than from import.meta.url,
// which points at the transformed module rather than the source file.
const WEB_DIR = resolve(process.cwd());
const APP_DIR = join(WEB_DIR, "app");

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "build" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(
  APP_DIR,
  (p) => (p.endsWith(".ts") || p.endsWith(".tsx")) && !p.includes("/test/"),
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function rel(path: string): string {
  return relative(APP_DIR, path);
}

/**
 * A `.server.ts` module holds the gateway token, the OAuth client secrets and
 * the session secret. Importing one from a component pulls it into the CLIENT
 * bundle, where those values become readable in a page source view. Vite would
 * usually tree-shake it out — "usually" is not a security property.
 */
describe("no server module reaches a component", () => {
  const componentFiles = sourceFiles.filter(
    (p) => p.includes("/components/") && !p.endsWith(".server.ts"),
  );

  it("finds components to check", () => {
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it.each(componentFiles.map((p) => [rel(p), p] as const))("%s", (_name, path) => {
    const imports = [...read(path).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    const serverImports = imports.filter((i) => i.includes(".server"));
    expect(serverImports, `${rel(path)} imports server-only modules`).toEqual([]);
  });
});

/**
 * The Go API's port is never published and the BFF is its only client. A
 * component that called it directly would be asking the BROWSER to reach a host
 * that does not resolve — and, if it ever did resolve, to hold the gateway
 * token to do it.
 */
describe("only server modules know the API", () => {
  const clientFiles = sourceFiles.filter(
    (p) => !p.endsWith(".server.ts") && !p.endsWith(".server.tsx"),
  );

  it.each(clientFiles.map((p) => [rel(p), p] as const))("%s", (_name, path) => {
    const src = read(path);
    expect(src, `${rel(path)} references ANYTOOLS_API_URL`).not.toMatch(/ANYTOOLS_API_URL/);
    expect(src, `${rel(path)} references the gateway token`).not.toMatch(/ANYTOOLS_GATEWAY_TOKEN/);
  });
});

/**
 * Secrets must be read in exactly one place. A second `process.env.ANYTOOLS_*`
 * read elsewhere is a second place a missing value degrades quietly instead of
 * failing at boot.
 */
describe("secrets are read only in env.server.ts", () => {
  const SECRET_VARS = [
    "ANYTOOLS_GATEWAY_TOKEN",
    "ANYTOOLS_SESSION_SECRET",
    "ANYTOOLS_GOOGLE_CLIENT_SECRET",
    "ANYTOOLS_GITHUB_CLIENT_SECRET",
  ];

  it("no module outside env.server.ts reads a secret from process.env", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles) {
      if (path.endsWith("lib/env.server.ts")) continue;
      const src = read(path);
      for (const v of SECRET_VARS) {
        if (src.includes(`process.env.${v}`) || src.includes(`process.env["${v}"]`)) {
          offenders.push(`${rel(path)} reads ${v}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Every route referenced by the sidebar must exist in routes.ts, or the nav
 * ships a link that 404s.
 */
describe("navigation links resolve", () => {
  it("every nav destination is a registered route", async () => {
    const routes = read(join(APP_DIR, "routes.ts"));
    const { NAV_ITEMS } = await import("~/components/layout/sidebar");

    expect(NAV_ITEMS.length).toBeGreaterThan(0);
    for (const { to } of NAV_ITEMS) {
      expect(routes, `no route registered for ${to}`).toContain(`"${to.replace(/^\//, "")}"`);
    }
  });
});

/**
 * Every i18n key a component asks for must exist in the English bundle. A
 * missing key renders as the raw key string, which ships as visible gibberish.
 */
describe("i18n keys exist in the en bundle", () => {
  // Every namespace i18n.ts bundles must be listed here, or a route using a
  // new one is checked against nothing and its keys ship as raw text.
  const bundles: Record<string, unknown> = {
    common: JSON.parse(read(join(WEB_DIR, "public/locales/en/common.json"))),
    auth: JSON.parse(read(join(WEB_DIR, "public/locales/en/auth.json"))),
    knowledge: JSON.parse(read(join(WEB_DIR, "public/locales/en/knowledge.json"))),
    study: JSON.parse(read(join(WEB_DIR, "public/locales/en/study.json"))),
    reading: JSON.parse(read(join(WEB_DIR, "public/locales/en/reading.json"))),
    solve: JSON.parse(read(join(WEB_DIR, "public/locales/en/solve.json"))),
    research: JSON.parse(read(join(WEB_DIR, "public/locales/en/research.json"))),
    loop: JSON.parse(read(join(WEB_DIR, "public/locales/en/loop.json"))),
    vocab: JSON.parse(read(join(WEB_DIR, "public/locales/en/vocab.json"))),
    profile: JSON.parse(read(join(WEB_DIR, "public/locales/en/profile.json"))),
    book: JSON.parse(read(join(WEB_DIR, "public/locales/en/book.json"))),
    ownversion: JSON.parse(read(join(WEB_DIR, "public/locales/en/ownversion.json"))),
    toolkit: JSON.parse(read(join(WEB_DIR, "public/locales/en/toolkit.json"))),
    listening: JSON.parse(read(join(WEB_DIR, "public/locales/en/listening.json"))),
    storage: JSON.parse(read(join(WEB_DIR, "public/locales/en/storage.json"))),
    tools: JSON.parse(read(join(WEB_DIR, "public/locales/en/tools.json"))),
    pages: JSON.parse(read(join(WEB_DIR, "public/locales/en/pages.json"))),
  };

  function lookup(ns: string, key: string): unknown {
    return key.split(".").reduce<unknown>(
      (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
      bundles[ns],
    );
  }

  it("the bundled resources are the same files the guard reads", () => {
    const i18nSrc = read(join(APP_DIR, "lib/i18n.ts"));
    for (const namespace of Object.keys(bundles)) {
      expect(i18nSrc, `i18n.ts does not bundle the ${namespace} namespace`).toContain(
        `public/locales/en/${namespace}.json`,
      );
    }
  });

  it("every namespace i18n.ts bundles is covered by this guard", () => {
    const i18nSrc = read(join(APP_DIR, "lib/i18n.ts"));
    const bundled = [...i18nSrc.matchAll(/public\/locales\/en\/([a-z]+)\.json/g)].map(
      (m) => m[1] ?? "",
    );
    for (const namespace of bundled) {
      expect(
        Object.keys(bundles),
        `add ${namespace} to this test's bundles map, or its keys go unchecked`,
      ).toContain(namespace);
    }
  });

  it("every bundled namespace is registered at runtime, not only imported", async () => {
    // Importing a JSON file is not registering it: a namespace missing from
    // `ns`/`resources` renders every one of its keys as raw text, and the key
    // check below cannot see that because it reads the JSON directly.
    const { initI18n, ns } = await import("~/lib/i18n");
    const i18n = initI18n("en");
    for (const namespace of Object.keys(bundles)) {
      expect(ns as readonly string[], `${namespace} is not in i18n.ts ns`).toContain(namespace);
      expect(i18n.hasResourceBundle("en", namespace), `${namespace} has no runtime bundle`).toBe(true);
    }
  });

  it("every literal t() key resolves", () => {
    const missing: string[] = [];

    for (const path of sourceFiles) {
      const src = read(path);
      const nsMatch = /useTranslation\(\s*"([^"]+)"\s*\)/.exec(src);
      if (!nsMatch) continue;
      const ns = nsMatch[1] ?? "common";

      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*\)/g)) {
        const key = m[1] ?? "";
        if (lookup(ns, key) === undefined) missing.push(`${rel(path)}: ${ns}:${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("the auth bundle covers every login error code", () => {
    const loginSrc = read(join(APP_DIR, "routes/login.tsx"));
    const errorKeys = [...loginSrc.matchAll(/"(errors\.[a-zA-Z]+)"/g)].map((m) => m[1] ?? "");

    expect(errorKeys.length).toBeGreaterThan(0);
    for (const key of errorKeys) {
      expect(lookup("auth", key), `auth:${key} missing`).toBeTypeOf("string");
    }
  });
});

/**
 * Knowledge-base status arrives on a stream. The interval underneath it is a
 * FALLBACK for a connection EventSource has given up on — a route that polls
 * unconditionally is the round trips the stream was added to remove, and one
 * that only streams leaves a finished document reading "Reading" forever when
 * the connection drops.
 */
describe("knowledge status streams, and only falls back to polling", () => {
  const src = read(join(APP_DIR, "routes/knowledge.$kbId.tsx"));

  it("opens the kb topic through the proxy", () => {
    expect(src).toMatch(/useEventStream/);
    expect(src, "the browser must not reach the API directly").toContain("/app/api/stream/kb/");
  });

  it("registers kb as an allowlisted topic", () => {
    const proxy = read(join(APP_DIR, "routes/app.api.stream.$topic.$id.ts"));
    expect(proxy).toMatch(/kb:\s*\(id\)\s*=>\s*`\/v1\/kb\/\$\{id\}\/events`/);
  });

  it("guards its interval on the stream having failed", () => {
    const interval = src.slice(src.indexOf("useEffect(() => {\n    if (!working"));
    expect(interval, "no guarded interval effect found").toContain("setInterval");
    expect(interval, "the poll runs even while the stream is healthy").toContain("streamDown");
  });
});

/**
 * Sign-out must be a POST. A GET logout is fired by any third-party
 * `<img src="/auth/logout">` the user's browser happens to load.
 */
describe("logout is not reachable by GET", () => {
  it("the logout route's loader only redirects and its action does the work", () => {
    const src = read(join(APP_DIR, "routes/auth.logout.tsx"));
    expect(src).toMatch(/export async function action/);
    expect(src).toMatch(/export async function loader/);
    // The loader must not destroy anything.
    const loaderBody = src.slice(src.indexOf("export async function loader"));
    expect(loaderBody).not.toMatch(/destroySession/);
  });

  it("the topbar submits logout with method=post", () => {
    const src = read(join(APP_DIR, "components/layout/topbar.tsx"));
    expect(src).toMatch(/method="post"/);
    expect(src).toMatch(/action="\/auth\/logout"/);
  });
});

describe("one activity panel per page", () => {
  it("every route that renders its own RightPanel tells app-layout to leave the slot", () => {
    const offenders = sourceFiles
      .filter((p) => p.includes("/routes/") && !p.endsWith("app-layout.tsx"))
      .filter((p) => /<RightPanel\b/.test(read(p)))
      .filter((p) => !/export const handle = \{ ownsPanel: true \}/.test(read(p)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

/**
 * The Google Picker needs the user's Drive access token in the browser, and
 * exactly one door hands it over: a POST resource route answered no-store. A
 * loader that fetched it instead would render the token into the HTML, keep it
 * in the router's cache and in history state — a credential in three places
 * that nobody reviewed as one.
 */
describe("the Picker token has one door", () => {
  it("only the picker-token route calls pickerToken()", () => {
    const callers = sourceFiles
      .filter((p) => !p.endsWith("lib/drive.server.ts"))
      .filter((p) => /\bpickerToken\(/.test(read(p)))
      .map(rel);
    expect(callers).toEqual(["routes/app.api.drive.picker-token.ts"]);
  });

  it("that route is action-only", () => {
    const src = read(join(APP_DIR, "routes/app.api.drive.picker-token.ts"));
    expect(src).toMatch(/export async function action/);
    expect(src).not.toMatch(/export (async )?function loader/);
  });

  it("the Picker script is client-only and loaded from components alone", () => {
    const importers = sourceFiles
      .filter((p) => /from\s+["']~\/lib\/google-picker/.test(read(p)))
      .map(rel);
    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(path, `${path} imports the Picker outside a component`).toMatch(/^components\//);
      expect(read(join(APP_DIR, path))).toMatch(/from\s+["']~\/lib\/google-picker\.client["']/);
    }
  });
});

/**
 * The phone bar has five slots at 390px: four destinations and "More". A fifth
 * destination shrinks every slot below a usable target, and the ones past the
 * edge become unreachable (measured: ten items, 46px each, Loop and Settings
 * off-screen).
 */
describe("the phone navigation fits", () => {
  it("at most four destinations are marked phone: true, and /more is a route", async () => {
    const { NAV_ITEMS, MORE_ITEM } = await import("~/components/layout/sidebar");
    expect(NAV_ITEMS.filter((n) => n.phone).length).toBeLessThanOrEqual(4);
    expect(read(join(APP_DIR, "routes.ts"))).toContain(`"${MORE_ITEM.to.slice(1)}"`);
  });
});

/**
 * The CSRF check (same-origin.server.ts) runs inside getUserId. An action that
 * never asks who the user is would never be checked, so every one must.
 */
describe("every action is origin-checked", () => {
  it("each route exporting an action reaches getUserId", () => {
    const unchecked = sourceFiles
      .filter((p) => p.includes("/routes/"))
      .filter((p) => /export (async )?function action\b/.test(read(p)))
      .filter((p) => !/\b(requireUser|requireUserId|getUserId)\(/.test(read(p)))
      .map(rel);
    expect(unchecked).toEqual([]);
  });
});
