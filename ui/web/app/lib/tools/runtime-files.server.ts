/**
 * tools/runtime-files.server.ts
 * Files a tool loads at run time by URL rather than by import: wasm, models,
 * language data, fonts (the old site's apps/anytools-web/public/third-party).
 *
 * They live in ui/web/tool-runtime/<package>@<version>/…, outside public/,
 * because react-router-serve gives public/ a one-hour cache and these are
 * megabytes. The version in the first segment is what makes a year-long
 * `immutable` safe: a new version is a new URL. Files a tool can import with
 * `?url` should be imported that way instead (Vite hashes them into
 * /assets/, already immutable); this is for libraries that fetch from a base
 * path they are given (tesseract's langPath, pdf.js cmaps, Excalidraw fonts).
 *
 * The path comes from the request, so it is checked segment by segment and
 * then confirmed to resolve inside the root, symlinks included.
 *
 * A file staged with a brotli copy beside it (`<file>.br`, made by the
 * staging script for entries marked `precompress`) is sent as that copy to a
 * browser that accepts br. Every response says the file's own size in
 * X-File-Size, as Content-Length is the encoded size or absent once encoded.
 *
 * An SVG is a document that can hold scripts, and these are served from the
 * app's origin: each is sent sandboxed with a policy that runs nothing, so
 * opening one directly cannot act as the app. As an <img> it never runs any.
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export const RUNTIME_ROOT = resolve(process.cwd(), "tool-runtime");

/** No leading dot, so neither `..` nor a dotfile can be named. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `tesseract@7.0.0`, `@jsquash/jpeg` flattened as `jsquash-jpeg@1.6.0`. */
const PACKAGE = /^[a-z0-9][a-z0-9._-]*@[0-9][A-Za-z0-9.+-]*$/;

const TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
  ".traineddata": "application/octet-stream",
  ".onnx": "application/octet-stream",
  ".gz": "application/gzip",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
};

/** Whether an Accept-Encoding header takes br (and not at q=0). */
export function acceptsBrotli(header: string | null | undefined): boolean {
  return (header ?? "").split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    if (name?.trim().toLowerCase() !== "br") return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
}

/** A file under `root`, or null for anything that is not one. */
export async function runtimeFile(
  root: string,
  splat: string,
  acceptEncoding?: string | null,
  method = "GET",
): Promise<Response | null> {
  const segments = splat.split("/");
  const [pkg] = segments;
  if (!pkg || !PACKAGE.test(pkg) || segments.length < 2) return null;
  if (!segments.slice(1).every((s) => SEGMENT.test(s))) return null;
  const type = TYPES[extname(splat).toLowerCase()];
  if (!type) return null;

  let real: string;
  let size: number;
  try {
    const realRoot = await realpath(root);
    real = await realpath(join(realRoot, ...segments));
    if (!real.startsWith(realRoot + sep)) return null;
    const info = await stat(real);
    if (!info.isFile()) return null;
    size = info.size;
  } catch {
    return null;
  }

  let brotli: number | null = null;
  try {
    const info = await stat(`${real}.br`);
    if (info.isFile()) brotli = info.size;
  } catch {
    // no brotli copy
  }
  const encoded = brotli !== null && acceptsBrotli(acceptEncoding);
  // A HEAD's body is dropped unread, so no file is opened for one.
  const body = method === "HEAD" ? null : (Readable.toWeb(createReadStream(encoded ? `${real}.br` : real)) as ReadableStream<Uint8Array>);
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(encoded ? brotli : size),
      "X-File-Size": String(size),
      ...(encoded ? { "Content-Encoding": "br" } : {}),
      ...(brotli !== null ? { Vary: "Accept-Encoding" } : {}),
      ...(type === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
