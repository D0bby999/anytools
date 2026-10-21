/**
 * vocab-write.test.tsx
 * The writing card (the private design notes, phase 3;
 * ux/03-writing.md): kana strokes split by animCJK are joined back, a word
 * is drawn character by character with each mistake counted, "Show the
 * character" counts as one and suggests Again, the rating is suggested from
 * the mistakes, and only a Chinese or Japanese word with characters gets the
 * card. hanzi-writer is replaced by a writer whose quiz the test drives.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync } from "node:fs";
import { initI18n } from "~/lib/i18n";
import { writable } from "~/lib/vocab-types";

type QuizCallbacks = {
  onCorrectStroke: (d: { strokeNum: number; strokesRemaining: number }) => void;
  onMistake: () => void;
  onComplete: () => void;
};
const writer = vi.hoisted(() => ({
  chars: [] as string[],
  quiz: null as QuizCallbacks | null,
  shown: 0,
  failOn: "",
}));
vi.mock("hanzi-writer", () => ({
  default: {
    create: (_el: HTMLElement, char: string) => {
      writer.chars.push(char);
      return {
        setCharacter: (c: string) => {
          writer.chars.push(c);
          return c === writer.failOn ? Promise.reject(new Error("404")) : Promise.resolve();
        },
        quiz: (cb: QuizCallbacks) => {
          writer.quiz = cb;
        },
        cancelQuiz: () => {
          writer.quiz = null;
        },
        showCharacter: () => {
          writer.shown++;
          return Promise.resolve();
        },
      };
    },
  },
}));

const { WritingPad, writingRating } = await import("~/components/vocab/writing-pad");
const { joinSplitStrokes, strokeData, drawable, lineIndex } = await import("~/lib/strokes.server");

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  writer.chars = [];
  writer.quiz = null;
  writer.shown = 0;
  writer.failOn = "";
});

describe("the stroke data", () => {
  it("joins a stroke animCJK split in two", () => {
    const tail = [[600, 400], [500, 200], [400, 100], [300, 50]];
    const joined = joinSplitStrokes({
      strokes: ["M1", "M2", "M3"],
      medians: [[[100, 100], [200, 200]], [[620, 420], ...tail], [[-150, 450], [-180, 420], ...tail]],
    });
    expect(joined.strokes).toEqual(["M1", "M2 M3"]);
    expect(joined.medians).toHaveLength(2);
    expect(joined.medians[1]?.[0]).toEqual([620, 420]);
  });

  it("leaves strokes that only touch alone", () => {
    const data = { strokes: ["A", "B"], medians: [[[0, 0], [100, 100]], [[100, 100], [200, 0]]] };
    expect(joinSplitStrokes(data)).toEqual(data);
  });

  it("serves only one Han character or kana", () => {
    expect(drawable("学")).toBe(true);
    expect(drawable("あ")).toBe(true);
    expect(drawable("ア")).toBe(true);
    expect(drawable("ab")).toBe(false);
    expect(drawable("../x")).toBe(false);
    expect(drawable("学习")).toBe(false);
  });

  // The staged data (scripts/stage-tool-runtime.mjs) is there in a dev tree;
  // a clean checkout without it skips this.
  it.skipIf(!existsSync("tool-runtime/makemeahanzi@0.0.0-bddc96d/graphics.txt"))(
    "counts kana and kanji strokes as they are written",
    async () => {
      const count = async (lang: "ja" | "zh", c: string) => (await strokeData(lang, c))?.strokes.length;
      expect(await count("ja", "あ")).toBe(3);
      expect(await count("ja", "ぬ")).toBe(2);
      expect(await count("ja", "ね")).toBe(2);
      expect(await count("ja", "の")).toBe(1);
      expect(await count("ja", "ネ")).toBe(4);
      expect(await count("ja", "学")).toBe(8);
      expect(await count("zh", "学")).toBe(8);
      expect(await strokeData("ja", "x")).toBeNull();
    },
  );
});

describe("the writing pad", () => {
  it("suggests Good, Hard or Again from the mistakes", () => {
    expect(writingRating({ mistakes: 0, shown: false })).toBe("good");
    expect(writingRating({ mistakes: 3, shown: false })).toBe("hard");
    expect(writingRating({ mistakes: 4, shown: false })).toBe("again");
    expect(writingRating({ mistakes: 0, shown: true })).toBe("again");
  });

  it("draws the word character by character, counting mistakes, skipping what has no strokes", async () => {
    const done = vi.fn();
    render(<WritingPad term="T勉強" lang="ja" onDone={done} />);
    await waitFor(() => expect(writer.quiz).not.toBeNull());
    expect(writer.chars).toEqual(["勉", "勉"]);
    act(() => {
      writer.quiz!.onMistake();
      writer.quiz!.onCorrectStroke({ strokeNum: 0, strokesRemaining: 9 });
    });
    expect(screen.getByText("Stroke 1 of 10 right.")).toBeInTheDocument();
    expect(screen.getByText("1 mistake")).toBeInTheDocument();
    const first = writer.quiz!;
    act(() => first.onComplete());
    await waitFor(() => expect(writer.quiz).not.toBe(first));
    expect(writer.chars.at(-1)).toBe("強");
    act(() => writer.quiz!.onComplete());
    expect(done).toHaveBeenCalledWith({ mistakes: 1, shown: false, drawn: 2 });
    expect(screen.getByText("Done: 1 mistake.")).toBeInTheDocument();
  });

  it("counts Show the character as a mistake and moves on by hand", async () => {
    const done = vi.fn();
    render(<WritingPad term="学习" lang="zh" onDone={done} />);
    await waitFor(() => expect(writer.quiz).not.toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Show the character" }));
    expect(writer.shown).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Next character" }));
    await waitFor(() => expect(writer.quiz).not.toBeNull());
    act(() => writer.quiz!.onComplete());
    expect(done).toHaveBeenCalledWith({ mistakes: 1, shown: true, drawn: 1 });
  });

  it("shows a character with no stroke data and lets the learner go on", async () => {
    writer.failOn = "𠮷";
    const done = vi.fn();
    render(<WritingPad term="𠮷" lang="ja" onDone={done} />);
    expect(await screen.findByText("No stroke data for 𠮷: look at it and go on.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(done).toHaveBeenCalledWith({ mistakes: 0, shown: false, drawn: 0 });
    // Nothing was drawn: no rating is suggested (independent review).
    expect(writingRating({ mistakes: 0, shown: false, drawn: 0 })).toBeNull();
  });
});

describe("which words get the card", () => {
  it("is a Chinese or Japanese word with characters to draw", () => {
    expect(writable("勉強", "ja")).toBe(true);
    expect(writable("学习", "zh-CN")).toBe(true);
    expect(writable("study", "ja")).toBe(false);
    expect(writable("勉強", "en")).toBe(false);
    expect(writable("한국어", "ko")).toBe(false);
  });
});

describe("the stroke files' index", () => {
  it("finds each line by where it is, across the chunks a file is read in", async () => {
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "strokes-"));
    const line = (c: string, pad = 0) => `{"character":"${c}","strokes":["${"M".repeat(pad)}"],"medians":[]}`;
    // 学's line starts 6 bytes before the first 64 KB chunk ends, so its
    // character is read across two chunks; 𠀀 is four bytes; 学 again is
    // ignored; the last line has no newline.
    const pad = 65_536 - 6 - 1 - Buffer.byteLength(line("一"));
    const lines = [line("一", pad), line("学", 200), line("𠀀"), "not a character line", line("学"), line("あ")];
    expect(Buffer.byteLength(lines[0]! + "\n")).toBe(65_530);
    const file = join(dir, "graphics.txt");
    await writeFile(file, lines.join("\n"));
    try {
      const found = new Map<string, { file: string; offset: number; length: number }>();
      await lineIndex(file, found);
      expect([...found.keys()]).toEqual(["一", "学", "𠀀", "あ"]);
      const bytes = await readFile(file);
      const at = (c: string) => {
        const p = found.get(c)!;
        return bytes.subarray(p.offset, p.offset + p.length).toString("utf8");
      };
      expect(at("学")).toBe(line("学", 200));
      expect(at("𠀀")).toBe(line("𠀀"));
      expect(at("あ")).toBe(line("あ"));
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
