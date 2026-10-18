/**
 * curlconverter-wasm-parser.ts
 * curlconverter (the curl-converter tool's server half) parses a command with
 * tree-sitter. Its Node entry loads the native `tree-sitter` and
 * `tree-sitter-bash` addons, whose prebuilt binaries are glibc builds; the web
 * image is node:22-alpine (musl), where they cannot load. Its browser entry
 * runs the same grammar compiled to wasm on web-tree-sitter, which loads
 * anywhere.
 *
 * This plugin swaps curlconverter's one parser module for
 * app/lib/tools/curl-parser.server.ts, which builds that wasm parser in Node.
 * curlconverter has to be bundled (ssr.noExternal, and server.deps.inline in
 * Vitest) for its relative import to be seen here at all; web-tree-sitter
 * stays external, a direct dependency, so it finds its own tree-sitter.wasm.
 * Nothing then imports the native addons (app/test/tools-server-routes.test.ts
 * checks the server build for them).
 */
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const CURL_PARSER_SHIM = fileURLToPath(new URL("../app/lib/tools/curl-parser.server.ts", import.meta.url));

/**
 * Only curlconverter is bundled. The packages it imports stay external, as in
 * Vitest (yamljs, a UMD bundle, breaks when bundled as ESM), so each is a
 * direct dependency in package.json for Node to find from build/server.
 */
export const CURLCONVERTER_BUNDLED = ["curlconverter"];

const PARSER_IMPORTER = /[\\/]curlconverter[\\/]dist[\\/]src[\\/]shell[\\/]/;

export function curlconverterWasmParser(): Plugin {
  return {
    name: "curlconverter-wasm-parser",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./Parser.js" && importer && PARSER_IMPORTER.test(importer)) return CURL_PARSER_SHIM;
      return null;
    },
  };
}
