/**
 * speech.test.ts
 * speech.ts against a fake speechSynthesis: sentence chunking, voice choice by
 * language (local first), the Markdown/LaTeX stripping, and a reading that
 * steps sentence by sentence and stops.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CHUNK,
  detectLang,
  pickVoice,
  plainText,
  readPrefs,
  speak,
  speechSupported,
  splitSentences,
  voicesFor,
  writePrefs,
} from "~/lib/speech";
import { installFakeSpeech, voice } from "./speech-fake";

const LINH = voice("Linh", "vi-VN");
const SAMANTHA = voice("Samantha", "en-US");
const GOOGLE_EN = voice("Google US English", "en-US", false);
const DANIEL = voice("Daniel", "en-GB");

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  window.localStorage.clear();
});

describe("splitSentences", () => {
  it("splits at terminal punctuation and keeps the punctuation", () => {
    expect(splitSentences("One here. Two there! Three? Four…  five")).toEqual([
      "One here.",
      "Two there!",
      "Three?",
      "Four…",
      "five",
    ]);
  });

  it("does not split a decimal or an abbreviation without a following space", () => {
    expect(splitSentences("Pi is 3.14 roughly. Next.")).toEqual(["Pi is 3.14 roughly.", "Next."]);
  });

  it("splits CJK text at its full stops", () => {
    expect(splitSentences("これは本です。あれはペンです。")).toEqual(["これは本です。", "あれはペンです。"]);
  });

  it("cuts a sentence longer than the chunk limit at a comma or space", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(", ") + ".";
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("folds whitespace and returns nothing for blank text", () => {
    expect(splitSentences("  \n ")).toEqual([]);
    expect(splitSentences("A\nline   break.")).toEqual(["A line break."]);
  });
});

describe("voice choice", () => {
  const all = [GOOGLE_EN, DANIEL, SAMANTHA, LINH];

  it("prefers a local voice for the language, then any", () => {
    expect(voicesFor(all, "en").map((v) => v.name)).toEqual(["Daniel", "Samantha", "Google US English"]);
    expect(pickVoice(all, "en")?.name).toBe("Daniel");
    expect(pickVoice([GOOGLE_EN], "en")?.name).toBe("Google US English");
  });

  it("matches on the primary language tag", () => {
    expect(pickVoice(all, "vi")?.name).toBe("Linh");
    expect(pickVoice(all, "vi-VN")?.name).toBe("Linh");
  });

  it("uses the voice the learner chose, even of another language", () => {
    expect(pickVoice(all, "en", SAMANTHA.voiceURI)?.name).toBe("Samantha");
    expect(pickVoice(all, "vi", SAMANTHA.voiceURI)?.name).toBe("Samantha");
    expect(pickVoice(all, "en", "gone")?.name).toBe("Daniel");
  });

  it("returns null rather than a voice of another language", () => {
    expect(pickVoice(all, "ja")).toBeNull();
    expect(pickVoice([], "en")).toBeNull();
  });
});

describe("plainText", () => {
  it("strips Markdown, citation markers and LaTeX", () => {
    const md = [
      "## The **key** idea",
      "",
      "Energy is $E = mc^2$ as [the paper](https://x.test) says [[cite:chunk:abc]].",
      "",
      "$$\\frac{a}{b}$$",
      "",
      "- one `item`",
      "| a | b |",
      "|---|---|",
      "```go\nfmt.Println()\n```",
    ].join("\n");
    expect(plainText(md)).toBe("The key idea Energy is as the paper says . one item a b");
  });

  it("keeps words with underscores and inline stars that are not emphasis", () => {
    expect(plainText("snake_case and _emph_")).toBe("snake_case and emph");
  });
});

describe("detectLang", () => {
  it("tells Vietnamese from English and reads scripts", () => {
    expect(detectLang("Học máy là một lĩnh vực của trí tuệ nhân tạo.")).toBe("vi");
    expect(detectLang("Machine learning is a field of AI.")).toBe("en");
    expect(detectLang("これは機械学習の本です。")).toBe("ja");
  });
});

describe("preferences", () => {
  it("remembers the rate and a voice per language in localStorage", () => {
    writePrefs({ rate: 1.25, voices: { vi: LINH.voiceURI } });
    expect(readPrefs()).toEqual({ rate: 1.25, voices: { vi: LINH.voiceURI } });
  });

  it("ignores a stored rate out of range", () => {
    window.localStorage.setItem("lp.speech", JSON.stringify({ rate: 9 }));
    expect(readPrefs().rate).toBe(1);
  });
});

describe("speak", () => {
  it("is unsupported without speechSynthesis", () => {
    expect(speechSupported()).toBe(false);
  });

  it("queues one utterance per sentence, reports each as it starts, and ends", () => {
    const { fake, remove } = installFakeSpeech([LINH]);
    cleanup = remove;
    expect(speechSupported()).toBe(true);
    const started: number[] = [];
    let ended = false;
    const reading = speak("Xin chào. Tôi là Linh.", {
      voice: LINH,
      lang: "vi",
      rate: 1.2,
      onSentence: (i) => started.push(i),
      onEnd: () => {
        ended = true;
      },
    });
    expect(reading.sentences).toEqual(["Xin chào.", "Tôi là Linh."]);
    expect(fake.queue.map((u) => [u.text, u.lang, u.rate, u.voice?.name])).toEqual([
      ["Xin chào.", "vi-VN", 1.2, "Linh"],
      ["Tôi là Linh.", "vi-VN", 1.2, "Linh"],
    ]);
    fake.step();
    expect(started).toEqual([0]);
    expect(ended).toBe(false);
    fake.step();
    expect(started).toEqual([0, 1]);
    expect(ended).toBe(true);
  });

  it("stop cancels the queue and reports no end", () => {
    const { fake, remove } = installFakeSpeech([SAMANTHA]);
    cleanup = remove;
    let ended = false;
    const reading = speak("One. Two. Three.", {
      voice: SAMANTHA,
      lang: "en",
      rate: 1,
      onEnd: () => {
        ended = true;
      },
    });
    fake.step();
    reading.stop();
    expect(fake.queue).toHaveLength(0);
    expect(fake.step()).toBe(false);
    expect(ended).toBe(false);
  });

  it("speaks with the language alone when there is no voice", () => {
    const { fake, remove } = installFakeSpeech([]);
    cleanup = remove;
    speak("Bonjour.", { voice: null, lang: "fr", rate: 1 });
    expect(fake.queue[0]?.lang).toBe("fr");
    expect(fake.queue[0]?.voice).toBeNull();
  });
});
