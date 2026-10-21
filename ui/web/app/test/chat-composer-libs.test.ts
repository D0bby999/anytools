import { describe, expect, it } from "vitest";
import { dropMention, matchCommands, mentionAt, parseSlash, planSend, slashQuery } from "~/lib/chat-slash";
import { decideShortcut, type ShortcutContext, type ShortcutKey } from "~/lib/chat-shortcuts";

const LABELS: Record<string, string> = {
  explain: "Giải thích",
  quiz: "Hỏi tôi",
  flashcards: "Thẻ ghi nhớ",
  summarise: "Tóm tắt",
  solve: "Giải bài",
  research: "Nghiên cứu",
  draw: "Vẽ",
};

describe("slash commands", () => {
  it("parses a known command and what follows it", () => {
    expect(parseSlash("/explain  photosynthesis ")).toMatchObject({ command: { id: "explain" }, rest: "photosynthesis" });
    expect(parseSlash("/solve")).toMatchObject({ command: { id: "solve", kind: "solve" }, rest: "" });
    expect(parseSlash("/nope x")).toBeNull();
    expect(parseSlash("explain /this")).toBeNull();
  });

  it("opens the menu only for a leading command without a space yet", () => {
    expect(slashQuery("/ex")).toBe("ex");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/explain x")).toBeNull();
    expect(slashQuery("a/b")).toBeNull();
  });

  it("matches the name or the label, without diacritics, starts first", () => {
    const label = (c: { id: string }) => LABELS[c.id]!;
    expect(matchCommands("giai", label).map((c) => c.id)).toEqual(["explain", "solve"]);
    expect(matchCommands("re", label).map((c) => c.id)).toEqual(["research"]);
    expect(matchCommands("", label)).toHaveLength(7);
  });
});

describe("what a message becomes", () => {
  const template = (id: string, topic: string) => `[${id}] ${topic}`;
  it("writes a prompt command's sentence, and starts Solve, Research or a drawing", () => {
    expect(planSend("/explain osmosis", false, template)).toEqual({ intent: "send", text: "[explain] osmosis" });
    expect(planSend("/solve 2x + 1 = 5", false, template)).toEqual({ intent: "solve", text: "2x + 1 = 5" });
    expect(planSend("/research ATP", false, template)).toEqual({ intent: "research", text: "ATP" });
    expect(planSend("/draw the cycle", false, template)).toEqual({ intent: "draw", text: "the cycle" });
  });

  it("sends a photo to Solve, and anything else as typed", () => {
    expect(planSend("", true, template)).toEqual({ intent: "solve", text: "" });
    expect(planSend("why?", false, template)).toEqual({ intent: "send", text: "why?" });
    expect(planSend("/unknown x", false, template)).toEqual({ intent: "send", text: "/unknown x" });
  });
});

describe("@ mentions", () => {
  it("finds the mention at the caret, at the start or after a space", () => {
    expect(mentionAt("@cel", 4)).toEqual({ query: "cel", start: 0 });
    expect(mentionAt("about @te-bao", 13)).toEqual({ query: "te-bao", start: 6 });
    expect(mentionAt("mail@x", 6)).toBeNull();
    expect(mentionAt("@cell done", 10)).toBeNull();
  });

  it("removes the mention from the text", () => {
    expect(dropMention("about @te what", 6, 9)).toBe("about what");
  });
});

describe("shortcuts", () => {
  const key = (k: Partial<ShortcutKey>): ShortcutKey => ({ key: "", mod: false, shift: false, alt: false, composing: false, ...k });
  const ctx = (c: Partial<ShortcutContext> = {}): ShortcutContext => ({ typing: false, hasModal: false, searchOpen: false, running: false, ...c });

  it("does nothing while an IME composes", () => {
    expect(decideShortcut(key({ key: "Escape", composing: true }), ctx({ running: true }))).toBeNull();
  });

  it("leaves Escape to an open dialog, never stopping the answer", () => {
    expect(decideShortcut(key({ key: "Escape" }), ctx({ hasModal: true, running: true }))).toBeNull();
  });

  it("closes find before stopping, and stops only a running answer", () => {
    expect(decideShortcut(key({ key: "Escape" }), ctx({ searchOpen: true, running: true }))).toBe("close-find");
    expect(decideShortcut(key({ key: "Escape" }), ctx({ running: true }))).toBe("stop");
    expect(decideShortcut(key({ key: "Escape" }), ctx())).toBeNull();
  });

  it("maps the modified keys", () => {
    expect(decideShortcut(key({ key: "f", mod: true }), ctx({ typing: true }))).toBe("find");
    expect(decideShortcut(key({ key: "O", mod: true, shift: true }), ctx())).toBe("new-conversation");
    expect(decideShortcut(key({ key: "Escape", shift: true }), ctx())).toBe("focus-composer");
  });

  it("takes ? for help only outside a field", () => {
    expect(decideShortcut(key({ key: "?", shift: true }), ctx())).toBe("help");
    expect(decideShortcut(key({ key: "?", shift: true }), ctx({ typing: true }))).toBeNull();
  });
});
