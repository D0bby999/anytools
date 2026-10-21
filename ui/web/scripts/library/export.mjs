/**
 * export.mjs
 * Writes internal/library/catalogue.json.gz, the whole Library as the API
 * loads it into Postgres (the private design notes), from
 * app/lib/library/export.server.ts. Run it after any script under
 * scripts/library/ changes a data file; app/test/library-export.test.ts
 * fails until it is.
 *
 * Usage: node scripts/library/export.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { createServer } from "vite";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(WEB, "../../internal/library/catalogue.json.gz");

// Vite loads the TypeScript module with the app's "~" alias and its JSON
// imports, without the app's plugins.
const vite = await createServer({
  root: WEB,
  configFile: false,
  logLevel: "error",
  resolve: { alias: { "~": join(WEB, "app") } },
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
try {
  const { catalogueExport } = await vite.ssrLoadModule("/app/lib/library/export.server.ts");
  const built = catalogueExport();
  // The sequence grows by one when the catalogue changes, so the API never
  // loads an older export over a newer one.
  const before = existsSync(OUT) ? JSON.parse(gunzipSync(readFileSync(OUT)).toString()) : { version: "", sequence: 0 };
  const last = Number(before.sequence) || 0;
  const sequence = before.version === built.version && last > 0 ? last : last + 1;
  const out = { version: built.version, sequence, sources: built.sources, items: built.items };
  // mtime 0 in the gzip header: the same catalogue writes the same bytes.
  writeFileSync(OUT, gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 }));
  console.log(`${out.items.length} items from ${out.sources.length} sources; version ${out.version.slice(0, 12)}, sequence ${sequence}`);
} finally {
  await vite.close();
}
