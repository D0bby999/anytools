/**
 * tools/curl-convert.server.ts
 * The curl-converter tool's server half (routes/api.curl-convert.ts): a curl
 * command in, code for one of five targets out. The old site's
 * /api/curl-convert, with the same targets and limits.
 *
 * curlconverter is loaded on first use. It parses with tree-sitter, through
 * the wasm parser that curl-parser.server.ts provides.
 */

/** The old route's ceiling on the command, in characters. */
export const MAX_CURL_CHARS = 8000;

export const TARGETS = ["fetch", "node-fetch", "python", "php", "go"] as const;
export type CurlTarget = (typeof TARGETS)[number];

type Convert = (curl: string) => string;
type CurlConverter = Record<"toJavaScript" | "toNodeFetch" | "toPython" | "toPhp" | "toGo", Convert>;

const GENERATOR: Record<CurlTarget, keyof CurlConverter> = {
  fetch: "toJavaScript",
  "node-fetch": "toNodeFetch",
  python: "toPython",
  php: "toPhp",
  go: "toGo",
};

let loaded: Promise<CurlConverter> | null = null;

function curlconverter(): Promise<CurlConverter> {
  loaded ??= import("curlconverter").then((m) => m as unknown as CurlConverter);
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

export function isCurlTarget(value: unknown): value is CurlTarget {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/** The command as code for `target`. Throws curlconverter's own error when it cannot parse. */
export async function convertCurl(curl: string, target: CurlTarget): Promise<string> {
  const cc = await curlconverter();
  return cc[GENERATOR[target]](curl);
}
