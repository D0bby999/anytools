/**
 * Strips cross-origin sources out of `FontFace` objects, so a font can only ever be fetched
 * from this origin.
 *
 * Why this exists. Excalidraw's `ExcalidrawFontFace.createUrls` always appends the package's
 * upstream CDN as a SECOND `src` inside every FontFace, and there is no option to turn that
 * off — `window.EXCALIDRAW_ASSET_PATH` (see ui.tsx) only controls the FIRST entry. Two
 * consequences, measured on production 2026-09-07:
 *
 *  1. The browser CSP-checks *every* source at construction time, not at fetch time. With
 *     `font-src 'self' data:` that is **230 violations on each whiteboard load**, each one a
 *     POST to /api/csp-report. The endpoint dedupes, so the log stays clean — but the requests
 *     are real, they are paid for on every visit, and they bury a genuine future violation in
 *     noise. Removing the source removes the check.
 *  2. If a font were ever missing from our own copy, the browser would fall through and fetch
 *     it from that third party. Nothing warns; the tool just works while quietly telling a CDN
 *     who is drawing. Dropping the entry turns that silent fallback into a visible missing
 *     font, which is the failure this site should prefer.
 *
 * Both are structural, not Excalidraw-specific, so the guard filters by origin rather than by
 * hostname — writing the CDN's name here is exactly what `vendor-assets.test.ts` forbids, and
 * an allowlist would need editing every time upstream changes host.
 *
 * Only string sources are touched. `new FontFace(family, arrayBuffer)` (a font supplied as
 * bytes) is passed through untouched, and so is any source list that has no same-origin entry
 * to fall back to — dropping the lot there would break the caller instead of protecting it.
 */

/** Marks the constructor as already wrapped, so a second call is a no-op. */
const INSTALLED = '__anytoolsSameOriginFontGuard';

type Guarded = typeof FontFace & { [INSTALLED]?: true };

/**
 * Splits a `src` descriptor into its comma-separated entries.
 *
 * Not `String.split(',')`: a URL may itself contain a comma (`url(data:font/woff2;base64,…)`
 * is the common one), and splitting naively would tear it in half. This walks the string and
 * only breaks on commas that are outside both quotes and parentheses.
 */
export function splitFontSources(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (c === ',' && depth === 0) {
      parts.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = src.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * True when an entry is safe to keep: anything that is not a `url()` (a `local()` face lives
 * on the machine already), or a `url()` that resolves to `origin`.
 *
 * `data:` and `blob:` URLs resolve to the opaque origin "null" rather than to `origin`, so they
 * are allowed explicitly — both are already inline bytes, with no third party involved.
 */
export function isSameOriginSource(entry: string, origin: string): boolean {
  const m = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/i.exec(entry);
  const raw = m?.[2]?.trim();
  if (!raw) return true;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return true;
  try {
    return new URL(raw, origin).origin === origin;
  } catch {
    // Unparseable: treat as local rather than silently discarding a source we do not understand.
    return true;
  }
}

/**
 * Rewrites a `src` descriptor to its same-origin entries.
 *
 * Returns the input unchanged when nothing would be dropped, and also when everything would be
 * — see the note above on not breaking a caller that has no local copy at all.
 */
export function filterFontSources(src: string, origin: string): string {
  const parts = splitFontSources(src);
  const kept = parts.filter((p) => isSameOriginSource(p, origin));
  if (kept.length === parts.length || kept.length === 0) return src;
  return kept.join(', ');
}

/**
 * Wraps `window.FontFace`. Must run BEFORE the module that constructs the faces is evaluated —
 * Excalidraw builds them at module scope, which is why ui.tsx imports it lazily.
 */
export function installSameOriginFontGuard(): void {
  if (typeof window === 'undefined') return;
  const Native = window.FontFace as Guarded | undefined;
  if (!Native || Native[INSTALLED]) return;

  const origin = window.location.origin;

  const Patched = function FontFace(
    this: unknown,
    family: string,
    source: string | BufferSource,
    descriptors?: FontFaceDescriptors,
  ) {
    const next = typeof source === 'string' ? filterFontSources(source, origin) : source;
    return new Native(family, next, descriptors);
  } as unknown as Guarded;

  // Keep `instanceof` and the prototype chain intact: Excalidraw hands these objects to
  // `document.fonts.add()`, which rejects anything that is not a real FontFace.
  Patched.prototype = Native.prototype;
  Object.setPrototypeOf(Patched, Native);
  Patched[INSTALLED] = true;
  window.FontFace = Patched;
}
