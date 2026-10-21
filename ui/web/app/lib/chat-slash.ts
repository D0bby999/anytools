/**
 * chat-slash.ts — the composer's `/` commands (pure; after postclaw's slash
 * command menu, mapped to what AnyLearn can do).
 *
 * A command is typed at the start of the message: `/explain photosynthesis`.
 * Its name is stable and English, like a shell's; the menu shows each one in
 * the learner's language and matches either, without diacritics.
 *
 * - `prompt` commands send a sentence written from the command's template
 *   (chat.slash.template.*), so the question in the transcript says what was
 *   asked, in the learner's language.
 * - `solve` and `research` start those capabilities on this conversation.
 * - `draw` draws the latest answer, with the rest as what to draw.
 */
import { fold } from "~/lib/chat-search";

export type SlashKind = "prompt" | "solve" | "research" | "draw";

export type SlashCommand = { id: string; kind: SlashKind };

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "explain", kind: "prompt" },
  { id: "quiz", kind: "prompt" },
  { id: "flashcards", kind: "prompt" },
  { id: "summarise", kind: "prompt" },
  { id: "solve", kind: "solve" },
  { id: "research", kind: "research" },
  { id: "draw", kind: "draw" },
];

export type ParsedSlash = { command: SlashCommand; rest: string };

/** The command a message starts with, and what follows it; null for none. */
export function parseSlash(text: string): ParsedSlash | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const command = SLASH_COMMANDS.find((c) => c.id === m[1]);
  return command ? { command, rest: (m[2] ?? "").trim() } : null;
}

/**
 * The query being typed after a leading `/` with no space yet ("/ex" → "ex"),
 * or null when the menu should be closed.
 */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1]! : null;
}

/** Commands whose name or localized label starts with, or contains, the query. */
export function matchCommands(query: string, label: (c: SlashCommand) => string): SlashCommand[] {
  const q = fold(query);
  if (q === "") return [...SLASH_COMMANDS];
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of SLASH_COMMANDS) {
    const names = [c.id, fold(label(c))];
    if (names.some((n) => n.startsWith(q))) starts.push(c);
    else if (names.some((n) => n.includes(q))) contains.push(c);
  }
  return [...starts, ...contains];
}

/**
 * The `@` mention being typed at the caret: "@cell" at the start or after a
 * space, with no space inside. Returns its query and where it starts, or null.
 */
export function mentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { query: m[2]!, start: before.length - m[2]!.length - 1 };
}

/** Removes the mention at `start` (up to the caret) from the text. */
export function dropMention(text: string, start: number, caret: number): string {
  return (text.slice(0, start) + text.slice(caret)).replace(/ {2,}/g, " ");
}

export type SendPlan = { intent: "send" | "solve" | "research" | "draw"; text: string };

/**
 * What a typed message becomes: a `prompt` command its template's sentence,
 * `/solve` (or a photo with no command) Solve, `/research` Research, `/draw`
 * a drawing of the latest answer; anything else the message as typed.
 */
export function planSend(message: string, hasPhoto: boolean, template: (id: string, topic: string) => string): SendPlan {
  const parsed = parseSlash(message);
  if (!parsed) return { intent: hasPhoto ? "solve" : "send", text: message };
  const { command, rest } = parsed;
  if (command.kind === "prompt") return { intent: "send", text: template(command.id, rest) };
  return { intent: command.kind, text: rest };
}

