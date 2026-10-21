/**
 * Terminal output with ANSI colour codes, read into styled runs, after
 * postclaw's `lib/chat-markdown/ansi.ts`. It returns data, never HTML: the
 * output was written by a program a model may have steered, so the block
 * builds React elements from these runs and nothing here becomes markup.
 *
 * Colours are the theme's, not the terminal's: the sixteen basic ones map onto
 * the `--lp-code-ansi-*` tokens, which are the world's own inks and pass AA on
 * both themes. Backgrounds, 256-colour and true-colour codes are dropped, so
 * text never lands on a colour nobody measured. A line redrawn with `\r`
 * (a progress bar) shows its last frame.
 */

export type AnsiStyle = { color?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean };
export type AnsiSpan = { text: string; style?: AnsiStyle };

const BASIC = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

const SGR = /\u001b\[([0-9;]*)m/g;
/** Every escape that is not colour: cursor moves, OSC titles and links, charset picks. */
const OTHER_ESCAPES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b\[[0-9;?]*[A-Za-ln-z]|\u001b(?![[\]])[\u0020-\u002f]*[\u0030-\u007e]?/g;
/** Control characters with no meaning on a page (tab and newline stay). */
const CONTROLS = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g;

/** Whether text holds a colour code worth reading. */
export function hasAnsi(text: string): boolean {
  return text.includes("\u001b[");
}

/** A line redrawn with carriage returns, as the terminal finally shows it. */
function lastFrame(line: string): string {
  if (!line.includes("\r")) return line;
  const cells: string[] = [];
  for (const frame of line.replace(SGR, "").split("\r")) {
    [...frame].forEach((ch, i) => (cells[i] = ch));
  }
  return cells.join("");
}

function apply(codes: number[], style: AnsiStyle): AnsiStyle {
  const next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) for (const key of Object.keys(next)) delete next[key as keyof AnsiStyle];
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) (delete next.bold, delete next.dim);
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code >= 30 && code <= 37) next.color = `var(--lp-code-ansi-${BASIC[code - 30]})`;
    else if (code >= 90 && code <= 97) next.color = `var(--lp-code-ansi-bright-${BASIC[code - 90]})`;
    else if (code === 39) delete next.color;
    // 38 and 48 carry 256-colour (5;n) or true-colour (2;r;g;b) arguments:
    // skip them whole so their numbers are not read as codes of their own.
    else if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
  }
  return next;
}

/** Output read into lines of styled runs; at least one line, maybe empty. */
export function parseAnsi(text: string): AnsiSpan[][] {
  const clean = text
    .replace(OTHER_ESCAPES, "")
    .split("\n")
    .map(lastFrame)
    .join("\n")
    .replace(CONTROLS, "");
  const lines: AnsiSpan[][] = [[]];
  let style: AnsiStyle = {};
  let at = 0;
  const push = (chunk: string) => {
    chunk.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== "") lines.at(-1)!.push(Object.keys(style).length ? { text: part, style } : { text: part });
    });
  };
  for (const match of clean.matchAll(SGR)) {
    push(clean.slice(at, match.index));
    style = apply((match[1] || "0").split(";").map(Number), style);
    at = match.index + match[0].length;
  }
  push(clean.slice(at));
  return lines;
}

/** The text a learner copies: the output without its codes. */
export function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((line) => line.map((s) => s.text).join(""))
    .join("\n");
}
