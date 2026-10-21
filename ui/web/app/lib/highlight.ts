import { createCssVariablesTheme, createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Syntax highlighting for fenced code, after postclaw's
 * `lib/chat-markdown/highlight.ts`. Only `components/rich-text/code-block.tsx`
 * imports this module, and only dynamically, once a closed fence with a known
 * language is on screen: prose never downloads shiki.
 *
 * - The JavaScript regex engine, not Oniguruma's WASM, so nothing more is
 *   fetched and the CSP needs nothing new.
 * - The css-variables theme: every colour is a `--lp-code-*` token from
 *   tokens.css, so light and dark are a CSS flip, never a second tokenising.
 * - Each grammar is its own chunk, fetched the first time a block needs it.
 * - Work is bounded: a block over MAX_HIGHLIGHT_CHARS stays plain.
 */

/** One coloured run of a line. */
export type HighlightSpan = { text: string; color: string; italic?: boolean; bold?: boolean };

/** Longest fence this tokenises; past it the block renders plain. */
export const MAX_HIGHLIGHT_CHARS = 20_000;

type Grammar = { default: Parameters<HighlighterCore["loadLanguageSync"]>[0] };

/**
 * The languages a learner meets: school and university courses, the web, data.
 * A Map, not an object, because the fence's language is model-written:
 * `constructor` or `__proto__` must miss, not find an inherited property.
 */
const GRAMMARS = new Map<string, () => Promise<Grammar>>([
  ["python", () => import("@shikijs/langs/python")],
  ["javascript", () => import("@shikijs/langs/javascript")],
  ["typescript", () => import("@shikijs/langs/typescript")],
  ["jsx", () => import("@shikijs/langs/jsx")],
  ["tsx", () => import("@shikijs/langs/tsx")],
  ["java", () => import("@shikijs/langs/java")],
  ["c", () => import("@shikijs/langs/c")],
  ["cpp", () => import("@shikijs/langs/cpp")],
  ["csharp", () => import("@shikijs/langs/csharp")],
  ["go", () => import("@shikijs/langs/go")],
  ["rust", () => import("@shikijs/langs/rust")],
  ["kotlin", () => import("@shikijs/langs/kotlin")],
  ["swift", () => import("@shikijs/langs/swift")],
  ["php", () => import("@shikijs/langs/php")],
  ["ruby", () => import("@shikijs/langs/ruby")],
  ["r", () => import("@shikijs/langs/r")],
  ["matlab", () => import("@shikijs/langs/matlab")],
  ["sql", () => import("@shikijs/langs/sql")],
  ["html", () => import("@shikijs/langs/html")],
  ["css", () => import("@shikijs/langs/css")],
  ["json", () => import("@shikijs/langs/json")],
  ["yaml", () => import("@shikijs/langs/yaml")],
  ["xml", () => import("@shikijs/langs/xml")],
  ["markdown", () => import("@shikijs/langs/markdown")],
  ["latex", () => import("@shikijs/langs/latex")],
  ["shellscript", () => import("@shikijs/langs/shellscript")],
]);

/** Fence names that are another name for a grammar above. */
const ALIASES = new Map<string, string>([
  ["py", "python"],
  ["python3", "python"],
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["ts", "typescript"],
  ["c++", "cpp"],
  ["cs", "csharp"],
  ["c#", "csharp"],
  ["golang", "go"],
  ["rs", "rust"],
  ["kt", "kotlin"],
  ["rb", "ruby"],
  ["jsonc", "json"],
  ["yml", "yaml"],
  ["md", "markdown"],
  ["tex", "latex"],
  ["bash", "shellscript"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["zsh", "shellscript"],
  ["console", "shellscript"],
]);

/** The grammar a fence's language names, if this highlighter has it. */
export function grammarFor(lang: string): string | undefined {
  const name = lang.trim().toLowerCase();
  if (GRAMMARS.has(name)) return name;
  return ALIASES.get(name);
}

const theme = createCssVariablesTheme({ name: "lp-code", variablePrefix: "--lp-code-", fontStyle: true });

let shared: HighlighterCore | undefined;
const loading = new Map<string, Promise<void>>();

function highlighter(): HighlighterCore {
  shared ??= createHighlighterCoreSync({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return shared;
}

/** Fetches and registers a grammar once, however many blocks ask at the same time. */
function load(grammar: string): Promise<void> {
  let pending = loading.get(grammar);
  if (!pending) {
    pending = GRAMMARS.get(grammar)!().then((mod) => {
      highlighter().loadLanguageSync(mod.default);
    });
    // A failed fetch (offline) may be tried again by the next block.
    pending.catch(() => loading.delete(grammar));
    loading.set(grammar, pending);
  }
  return pending;
}

/**
 * Highlights a fence into one run list per line, or `undefined` when the
 * language is unknown, the block is too long, or the grammar would not load:
 * every one of those renders the plain text instead.
 */
export async function highlightLines(code: string, lang: string): Promise<HighlightSpan[][] | undefined> {
  const grammar = grammarFor(lang);
  if (!grammar || code.length > MAX_HIGHLIGHT_CHARS) return undefined;
  try {
    await load(grammar);
  } catch {
    return undefined;
  }
  const { tokens } = highlighter().codeToTokens(code, { lang: grammar, theme: "lp-code" });
  return tokens.map((line) =>
    line.map((token) => {
      const span: HighlightSpan = { text: token.content, color: token.color ?? "var(--lp-code-foreground)" };
      const style = token.fontStyle ?? 0;
      if (style & 1) span.italic = true;
      if (style & 2) span.bold = true;
      return span;
    }),
  );
}
