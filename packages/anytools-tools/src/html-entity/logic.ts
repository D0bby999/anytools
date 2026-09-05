import he from 'he';

export type EncodeOptions = {
  /** Escape every character, including plain ASCII letters. */
  encodeEverything?: boolean;
  /** Also turn non-ASCII text into references: "chào" → "ch&agrave;o". */
  encodeNonAscii?: boolean;
  useNamedReferences?: boolean;
};

/**
 * Default is the HTML-safety escape (& < > " ' `) and nothing else. `he.encode` used to be
 * the default and it references every non-ASCII symbol, so Vietnamese, Spanish and
 * Portuguese text — the site's own languages — came back as entity soup ("Xin ch&agrave;o")
 * for anyone who only wanted their markup made safe.
 */
export function encodeHtml(text: string, options: EncodeOptions = {}): string {
  const useNamedReferences = options.useNamedReferences ?? true;
  if (options.encodeEverything) {
    return he.encode(text, { encodeEverything: true, useNamedReferences });
  }
  if (options.encodeNonAscii) {
    return he.encode(text, { useNamedReferences });
  }
  return he.escape(text);
}

export function decodeHtml(html: string): string {
  return he.decode(html);
}
