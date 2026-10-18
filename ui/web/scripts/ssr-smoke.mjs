/**
 * ssr-smoke.mjs
 * Loads the production server build (build/server/index.js) in plain Node, as
 * react-router-serve does, and asks it for every public URL the old site had
 * (app/test/fixtures/old-anytools-urls.txt). Any answer of 500 or more fails.
 *
 * Vitest runs the app through Vite, which forgives what Node's ESM loader does
 * not (a named import from a CommonJS package, for one), so a page can pass
 * every test and still fail in production. Run after `pnpm build`:
 *   node scripts/ssr-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.ANYTOOLS_API_URL ??= "http://127.0.0.1:9";
process.env.ANYTOOLS_APP_URL ??= "http://localhost";
process.env.ANYTOOLS_GATEWAY_TOKEN ??= "0".repeat(64);
process.env.ANYTOOLS_SESSION_SECRET ??= "1".repeat(64);

const { createRequestHandler } = await import("react-router");
const build = await import(pathToFileURL(join(WEB, "build/server/index.js")).href);
const handle = createRequestHandler(build, "production");

const paths = readFileSync(join(WEB, "app/test/fixtures/old-anytools-urls.txt"), "utf8")
  .split("\n")
  .map((p) => p.trim() || "/");
const failed = [];
for (const path of new Set(paths)) {
  const res = await handle(new Request(`http://localhost${path}`));
  if (res.status >= 500) failed.push(`${res.status} ${path}`);
  await res.body?.cancel();
}
if (failed.length > 0) {
  console.error(`ssr-smoke: ${failed.length} of ${paths.length} URLs failed\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`ssr-smoke: ${new Set(paths).size} URLs, none failed`);
