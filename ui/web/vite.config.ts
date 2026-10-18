import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { CURLCONVERTER_BUNDLED, curlconverterWasmParser } from "./vite-plugins/curlconverter-wasm-parser";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), curlconverterWasmParser()],
  // AnyTools phase 3a: curlconverter runs on its wasm parser, which it can
  // only be given when bundled (vite-plugins/curlconverter-wasm-parser.ts).
  ssr: { noExternal: CURLCONVERTER_BUNDLED },
  // No dev proxy to the Go API. The browser must never hold a route to it —
  // every API call goes through a loader or action on this server, which adds
  // the gateway bearer and the user id. A proxy entry here would quietly
  // reopen the path the trust boundary exists to close.
  server: { port: 3000 },
  // Tool workers (jq-playground, json-schema-validator) load their engine with a
  // dynamic import, which only an ES-module worker can split. They are created
  // with `{ type: "module" }` to match.
  worker: { format: "es" },
});
