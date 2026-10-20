/**
 * strokes.server.ts
 * The stroke data of one character, for the writing card
 * (plans/261020-1535-beyond-english-learning-areas, phase 3), in
 * hanzi-writer's shape: each stroke's outline and its median line, in the
 * Make Me A Hanzi frame (1024 wide, y up, baseline at 900).
 *
 * Chinese: Make Me A Hanzi's graphics.txt (Arphic PL), the data
 * hanzi-writer-data is built from, 9,574 characters. Japanese: animCJK
 * (Arphic PL for the graphics, LGPL for the rest), whose kanji have
 * Japanese stroke forms and which has the kana. Each is one file, a JSON line
 * per character, read once and indexed. Both are staged under tool-runtime/
 * by scripts/stage-tool-runtime.mjs, with their licences.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNTIME_ROOT } from "~/lib/tools/runtime-files.server";

export const ZH_DATA = "makemeahanzi@0.0.0-bddc96d";
export const JA_DATA = "animcjk@0.0.0-3e1253b";

const FILES: Record<"zh" | "ja", string[]> = {
  zh: [join(ZH_DATA, "graphics.txt")],
  ja: [join(JA_DATA, "graphicsJaKana.txt"), join(JA_DATA, "graphicsJa.txt")],
};

export type StrokeData = { strokes: string[]; medians: number[][][] };

/** One Han character or kana: the only thing a file is ever looked up by. */
export function drawable(char: string): boolean {
  return [...char].length === 1 && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(char);
}

/**
 * animCJK splits a stroke that crosses itself (あ, ぬ, の…) into shapes that
 * share one median, for its animation: the second's median is the first's
 * with a few points before it. A learner draws it as one stroke, so the
 * shapes are joined back: one outline of both, the first one's median. A
 * part is told by its median: it ends where the stroke before it ends, and
 * either repeats most of that median, starts outside the frame, or starts
 * where it starts too (ね's loop).
 */
export function joinSplitStrokes(data: StrokeData): StrokeData {
  const strokes: string[] = [];
  const medians: number[][][] = [];
  data.medians.forEach((median, i) => {
    const prev = medians[medians.length - 1];
    if (prev && (sameTail(prev, median) || (sameEnd(prev, median) && (offFrame(median[0]) || samePoint(prev[0], median[0]))))) {
      strokes[strokes.length - 1] += ` ${data.strokes[i]}`;
      return;
    }
    strokes.push(data.strokes[i] ?? "");
    medians.push(median);
  });
  return { strokes, medians };
}

/** The frame is 0–1024 across and −124–900 up; a split part's median starts outside it. */
function offFrame(p: number[] | undefined): boolean {
  return !p || p[0]! < 0 || p[0]! > 1024 || p[1]! < -124 || p[1]! > 900;
}

function samePoint(p: number[] | undefined, q: number[] | undefined): boolean {
  return Boolean(p && q && p[0] === q[0] && p[1] === q[1]);
}

function sameEnd(a: number[][], b: number[][]): boolean {
  return samePoint(a[a.length - 1], b[b.length - 1]);
}

/** The two medians end the same way: at least three points and half the shorter one. */
function sameTail(a: number[][], b: number[][]): boolean {
  const shorter = Math.min(a.length, b.length);
  let k = 0;
  while (k < shorter) {
    const p = a[a.length - 1 - k];
    const q = b[b.length - 1 - k];
    if (!p || !q || p[0] !== q[0] || p[1] !== q[1]) break;
    k++;
  }
  return k >= 3 && k * 2 >= shorter;
}

const indexes = new Map<string, Promise<Map<string, string>>>();

/** A language's graphics, one JSON line per character, read once. */
function index(lang: "zh" | "ja", root: string): Promise<Map<string, string>> {
  const key = `${root}\0${lang}`;
  let found = indexes.get(key);
  if (!found) {
    found = (async () => {
      const byChar = new Map<string, string>();
      for (const file of FILES[lang]) {
        const text = await readFile(join(root, file), "utf8");
        for (const line of text.split("\n")) {
          const m = /^\{"character":"(.+?)"/u.exec(line);
          if (m?.[1] && !byChar.has(m[1])) byChar.set(m[1], line);
        }
      }
      return byChar;
    })();
    // A failed read is tried again next time, not remembered.
    found.catch(() => indexes.delete(key));
    indexes.set(key, found);
  }
  return found;
}

/** The character's strokes in `lang` (zh or ja), or null when there are none. */
export async function strokeData(lang: "zh" | "ja", char: string, root = RUNTIME_ROOT): Promise<StrokeData | null> {
  if (!drawable(char)) return null;
  const line = (await index(lang, root)).get(char);
  if (!line) return null;
  const row = JSON.parse(line) as StrokeData;
  const data = { strokes: row.strokes, medians: row.medians };
  // Only animCJK splits strokes; Make Me A Hanzi's are whole.
  return lang === "ja" ? joinSplitStrokes(data) : data;
}
