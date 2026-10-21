/**
 * A unified diff, read into classified rows for the diff block, after
 * postclaw's `lib/chat-markdown/diff-render.ts`. A `diff` fence is the signal,
 * so lines are classed by their first character; a bare hunk with no file
 * header (how a model usually writes one) reads as well as a full patch.
 * It returns data, never HTML.
 */

export type DiffKind = "add" | "remove" | "context" | "hunk" | "meta";
export type DiffRow = { kind: DiffKind; sign: string; text: string };
export type ParsedDiff = { rows: DiffRow[]; added: number; removed: number; clipped: boolean };

/** Most rows drawn; a whole lockfile's patch would otherwise be thousands. */
export const MAX_DIFF_ROWS = 600;

const META = /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |\\ No newline)/;

function rowOf(line: string): DiffRow {
  if (line.startsWith("@@")) return { kind: "hunk", sign: "", text: line };
  if (META.test(line)) return { kind: "meta", sign: "", text: line };
  if (line.startsWith("+")) return { kind: "add", sign: "+", text: line.slice(1) };
  if (line.startsWith("-")) return { kind: "remove", sign: "-", text: line.slice(1) };
  return { kind: "context", sign: "", text: line.startsWith(" ") ? line.slice(1) : line };
}

export function parseDiff(text: string): ParsedDiff {
  const lines = text.split("\n");
  const rows = lines.slice(0, MAX_DIFF_ROWS).map(rowOf);
  let added = 0;
  let removed = 0;
  // Counted over the whole diff, so a clipped one still says how big it is.
  for (const line of lines) {
    const kind = rowOf(line).kind;
    if (kind === "add") added++;
    else if (kind === "remove") removed++;
  }
  return { rows, added, removed, clipped: lines.length > MAX_DIFF_ROWS };
}
