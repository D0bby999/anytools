/**
 * 0-dep table of Cyrillic and Greek letters that render identically to a Latin letter — the
 * classic domain-spoofing/phishing confusable set, plus the exact pair (Cyrillic је/а) that
 * broke a real Spanish FAQ sentence in commit 9c8a1f1 of this repo. Deliberately not the npm
 * package `unicode-confusables` (abandoned since 2022; this table covers what this tool needs
 * and nothing more).
 */

export type Script = 'latin' | 'cyrillic' | 'greek';
export type Homoglyph = { latin: string; script: Script; name: string };

/** [codepoint, Latin letter it is drawn identically to, Unicode character name]. */
const CYRILLIC_PAIRS: [number, string, string][] = [
  [0x0430, 'a', 'Cyrillic small letter a'],
  [0x0435, 'e', 'Cyrillic small letter ie'],
  [0x043e, 'o', 'Cyrillic small letter o'],
  [0x0440, 'p', 'Cyrillic small letter er'],
  [0x0441, 'c', 'Cyrillic small letter es'],
  [0x0445, 'x', 'Cyrillic small letter ha'],
  [0x0443, 'y', 'Cyrillic small letter u'],
  [0x0456, 'i', 'Cyrillic small letter byelorussian-ukrainian i'],
  [0x0455, 's', 'Cyrillic small letter dze'],
  [0x0458, 'j', 'Cyrillic small letter je'],
  [0x0410, 'A', 'Cyrillic capital letter a'],
  [0x0412, 'B', 'Cyrillic capital letter ve'],
  [0x0415, 'E', 'Cyrillic capital letter ie'],
  [0x041a, 'K', 'Cyrillic capital letter ka'],
  [0x041c, 'M', 'Cyrillic capital letter em'],
  [0x041d, 'H', 'Cyrillic capital letter en'],
  [0x041e, 'O', 'Cyrillic capital letter o'],
  [0x0420, 'P', 'Cyrillic capital letter er'],
  [0x0421, 'C', 'Cyrillic capital letter es'],
  [0x0422, 'T', 'Cyrillic capital letter te'],
  [0x0425, 'X', 'Cyrillic capital letter ha'],
  [0x0405, 'S', 'Cyrillic capital letter dze'],
  [0x0408, 'J', 'Cyrillic capital letter je'],
  [0x0406, 'I', 'Cyrillic capital letter byelorussian-ukrainian i'],
];

const GREEK_PAIRS: [number, string, string][] = [
  [0x03bd, 'v', 'Greek small letter nu'],
  [0x03bf, 'o', 'Greek small letter omicron'],
  [0x03b1, 'a', 'Greek small letter alpha'],
  [0x03c1, 'p', 'Greek small letter rho'],
  [0x03c4, 't', 'Greek small letter tau'],
  [0x0391, 'A', 'Greek capital letter alpha'],
  [0x0392, 'B', 'Greek capital letter beta'],
  [0x0395, 'E', 'Greek capital letter epsilon'],
  [0x0397, 'H', 'Greek capital letter eta'],
  [0x0399, 'I', 'Greek capital letter iota'],
  [0x039a, 'K', 'Greek capital letter kappa'],
  [0x039c, 'M', 'Greek capital letter mu'],
  [0x039d, 'N', 'Greek capital letter nu'],
  [0x039f, 'O', 'Greek capital letter omicron'],
  [0x03a1, 'P', 'Greek capital letter rho'],
  [0x03a4, 'T', 'Greek capital letter tau'],
  [0x03a7, 'X', 'Greek capital letter chi'],
];

export const HOMOGLYPHS = new Map<string, Homoglyph>();
for (const [cp, latin, name] of CYRILLIC_PAIRS) {
  HOMOGLYPHS.set(String.fromCodePoint(cp), { latin, script: 'cyrillic', name });
}
for (const [cp, latin, name] of GREEK_PAIRS) {
  HOMOGLYPHS.set(String.fromCodePoint(cp), { latin, script: 'greek', name });
}
