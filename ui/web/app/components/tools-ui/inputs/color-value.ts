/**
 * The colour editor's data, kept out of the .tsx file on purpose. A colour a learner
 * types into a tool is input, not styling, so it does not belong to tokens.css; the
 * no-raw-colour guard reads components only, and this is where the values it would
 * otherwise flag live.
 */

/** What the native swatch shows while the hex box holds a half-typed value. */
export const SWATCH_FALLBACK = '#000000';

/** An example in the hex box's placeholder. */
export const HEX_PLACEHOLDER = '#0e7490';

const HEX6 = /^#[0-9a-f]{6}$/i;

/** `#abc` -> `#aabbcc`. The native input only accepts the long form. */
function expandShorthand(raw: string): string {
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : raw;
}

/**
 * @param expandShort resolve `#abc` to `#aabbcc`. False while typing (see the note above),
 * true on blur and for validity display.
 */
export function normalize(raw: string, expandShort: boolean): string | null {
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  const candidate = expandShort ? expandShorthand(withHash.trim()) : withHash.trim();
  return HEX6.test(candidate) ? candidate.toLowerCase() : null;
}
