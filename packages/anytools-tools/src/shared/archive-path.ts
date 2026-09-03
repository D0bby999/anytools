/**
 * Turn any name found in (or destined for) an archive into a safe relative path.
 *
 * Nothing here writes to a disk, so a `../../etc/passwd` entry inside an uploaded archive
 * cannot escape anything while it is only being listed. It becomes real the moment the user
 * asks for "download all": the browser writes the archive we build to their Downloads folder,
 * and a path in a zip is not validated by every extractor that will later open it. Carrying an
 * attacker's traversal path through our re-zip would make this site the delivery vehicle for
 * the classic Zip Slip bug (CVE-2018-1002200 and relatives) even though we never wrote a file.
 *
 * So: normalise once, on the way into any zip we generate.
 */

/** Path segments that must never survive: they are how a traversal is spelled. */
const UNSAFE_SEGMENT = /^(\.\.?|)$/;
/** `C:` and friends — an absolute Windows path smuggled in as a name. */
const DRIVE_LETTER = /^[a-z]:$/i;
/**
 * C0 controls and DEL. A filename carrying them breaks terminals and confuses extractors, and
 * a `\r` is a classic way to hide the real extension from a listing.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the entire point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * `a/../../b\c` becomes `a/b/c`; `/abs/path` becomes `abs/path`; an empty result becomes
 * `unnamed`, because a zip entry with no name is not addressable.
 */
export function normaliseArchivePath(raw: string): string {
  const segments = raw
    .replace(CONTROL_CHARS, '')
    // A zip written on Windows may use backslashes; treat them as separators, not as
    // characters that are legal inside one name.
    .replace(/\\/g, '/')
    .split('/')
    .filter((s, i) => !UNSAFE_SEGMENT.test(s) && !(i === 0 && DRIVE_LETTER.test(s)));
  return segments.join('/') || 'unnamed';
}

/**
 * Make every path in a list unique, keeping the first occurrence as-is.
 *
 * Two files called `photo.jpg` from different folders collapse to one entry in a zip built
 * from a flat file list — the second silently replaces the first. Suffix before the extension
 * so the result still opens in the right application.
 */
export function deduplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.map((path) => {
    if (!seen.has(path)) {
      seen.add(path);
      return path;
    }
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const cut = dot > slash + 1 ? dot : path.length;
    const [stem, ext] = [path.slice(0, cut), path.slice(cut)];
    let n = 2;
    let candidate = `${stem} (${n})${ext}`;
    while (seen.has(candidate)) {
      n += 1;
      candidate = `${stem} (${n})${ext}`;
    }
    seen.add(candidate);
    return candidate;
  });
}
