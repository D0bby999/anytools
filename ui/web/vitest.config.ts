/**
 * Kept separate from vite.config.ts so the app build stays untouched by test
 * tooling.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { curlconverterWasmParser } from "./vite-plugins/curlconverter-wasm-parser";

export default defineConfig({
  plugins: [react(), curlconverterWasmParser()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./app/test/setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
    // Vitest stubs CSS imports to "" by default, `?raw` included. The OG card
    // reads its colours from tokens.css?raw (lib/tools/og-image.server.ts).
    css: { include: [/tokens\.css/] },
    exclude: ["**/node_modules/**", "**/build/**"],
    // Inlined so the curl-converter tests run curlconverter on the same wasm
    // parser as the server build (vite-plugins/curlconverter-wasm-parser.ts).
    server: { deps: { inline: ["curlconverter"] } },
  },
  resolve: {
    alias: { "~": resolve(__dirname, "app") },
  },
});
