/**
 * chat-shortcuts.ts — what a key does on the conversation page (pure; after
 * postclaw's lib/chat-shortcuts.ts).
 *
 * One decision function, so the precedence is a list in one file with a test
 * per rule, rather than an accident of which listener mounted first:
 *
 * 1. While an IME is composing, nothing fires: typing Vietnamese with a tone
 *    mark passes through keys that would otherwise act.
 * 2. A dialog owns Escape: it closes the dialog and never stops an answer.
 * 3. Escape closes the find bar before it stops anything.
 * 4. Escape stops an answer only while one is being written.
 * 5. Keys that type text (`?`) act only outside a field.
 *
 * Mod is ⌘ on macOS and Ctrl elsewhere. ⌘K belongs to the top nav's search.
 */

export type ShortcutKey = {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
  composing: boolean;
};

export type ShortcutContext = {
  /** Focus is in a field (input, textarea, contenteditable). */
  typing: boolean;
  /** A dialog is open over the page. */
  hasModal: boolean;
  searchOpen: boolean;
  running: boolean;
};

export type ShortcutAction = "find" | "close-find" | "stop" | "help" | "new-conversation" | "focus-composer" | null;

export function decideShortcut(k: ShortcutKey, ctx: ShortcutContext): ShortcutAction {
  if (k.composing) return null;
  const key = k.key.toLowerCase();
  if (key === "escape") {
    if (ctx.hasModal) return null;
    if (k.shift) return "focus-composer";
    if (ctx.searchOpen) return "close-find";
    if (ctx.running) return "stop";
    return null;
  }
  if (ctx.hasModal) return null;
  if (k.mod && !k.alt) {
    if (key === "f" && !k.shift) return "find";
    if (key === "o" && k.shift) return "new-conversation";
    return null;
  }
  if (!k.mod && !k.alt && k.key === "?" && !ctx.typing) return "help";
  return null;
}

/** True on Apple platforms, where Mod is ⌘. */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** The shortcuts the help dialog lists, as keys and a label key. */
export const SHORTCUTS: readonly { keys: string[]; labelKey: string }[] = [
  { keys: ["Enter"], labelKey: "chat.shortcuts.send" },
  { keys: ["Shift", "Enter"], labelKey: "chat.shortcuts.newline" },
  { keys: ["Esc"], labelKey: "chat.shortcuts.stop" },
  { keys: ["Shift", "Esc"], labelKey: "chat.shortcuts.focus" },
  { keys: ["/"], labelKey: "chat.shortcuts.commands" },
  { keys: ["@"], labelKey: "chat.shortcuts.mention" },
  { keys: ["Mod", "F"], labelKey: "chat.shortcuts.find" },
  { keys: ["Mod", "K"], labelKey: "chat.shortcuts.search" },
  { keys: ["Mod", "Shift", "O"], labelKey: "chat.shortcuts.new" },
  { keys: ["?"], labelKey: "chat.shortcuts.help" },
];
