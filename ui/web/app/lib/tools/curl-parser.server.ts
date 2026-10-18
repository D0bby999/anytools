/**
 * tools/curl-parser.server.ts
 * curlconverter's parser, built on web-tree-sitter (wasm) in place of the
 * native addon its Node entry loads; vite-plugins/curlconverter-wasm-parser.ts
 * says why and how it is swapped in. The grammar is the tree-sitter-bash.wasm
 * curlconverter ships for its own browser build, read from its package.
 *
 * Top-level await, as in curlconverter's browser parser: the parser is ready
 * when the import resolves. Only curl-convert.server.ts reaches this, through
 * a dynamic import, so the wasm loads on the first conversion, not at start.
 */
import { createRequire } from "node:module";
import Parser from "web-tree-sitter";

const require = createRequire(import.meta.url);

await Parser.init();
const bash = await Parser.Language.load(require.resolve("curlconverter/dist/tree-sitter-bash.wasm"));
const parser = new Parser();
parser.setLanguage(bash);

export default parser;
