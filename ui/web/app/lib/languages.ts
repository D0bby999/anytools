/**
 * languages.ts
 * The languages a learner can study (the private design notes, phase 1): their names, where to look a word up, and what a
 * word's reading is called. Names come from the browser's own data
 * (Intl.DisplayNames), so no list of names is kept here; a code is what the
 * server stores (vocab.ValidLang).
 */

/** Offered first in the picker, in this order. */
/** vocab.MaxStudied: the most languages a learner studies at once. */
export const MAX_STUDIED = 20;

export const COMMON_LANGUAGES = ["en", "zh", "ja", "ko", "fr", "de", "es", "pt", "it", "ru", "vi"] as const;

/** Every ISO 639-1 code: the picker's search. */
export const ALL_LANGUAGES = (
  "aa ab af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el " +
  "en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it " +
  "iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt " +
  "my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl " +
  "sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo " +
  "za zh zu"
).split(" ");

/** A code the server accepts: en, vi, pt-BR. */
export function isLanguageCode(s: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s);
}

function displayName(code: string, inLanguage: string): string {
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language", fallback: "code" }).of(code) ?? code;
    // Some languages name themselves in lower case ("tiếng Việt", "español").
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1);
  } catch {
    return code;
  }
}

/** The language's name in the learner's interface language: "Tiếng Nhật". */
export function languageName(code: string, uiLanguage: string): string {
  return displayName(code, uiLanguage);
}

/** The name inside a sentence: "tiếng Nhật", "japonés"; English keeps its capital. */
export function languageNameInSentence(code: string, uiLanguage: string): string {
  const name = displayName(code, uiLanguage);
  return uiLanguage.startsWith("en") ? name : name.charAt(0).toLocaleLowerCase(uiLanguage) + name.slice(1);
}

/** The language's name in itself: "日本語". */
export function nativeName(code: string): string {
  return displayName(code, code);
}

export type Lookup = { name: string; url: string };

/** One good dictionary per language, besides Wiktionary. */
const DICTIONARIES: Record<string, Lookup> = {
  en: { name: "Cambridge", url: "https://dictionary.cambridge.org/dictionary/english/{term}" },
  ja: { name: "Jisho", url: "https://jisho.org/search/{term}" },
  zh: { name: "MDBG", url: "https://www.mdbg.net/chinese/dictionary?wdqb={term}" },
  ko: { name: "Naver", url: "https://korean.dict.naver.com/koendict/#/search?query={term}" },
  fr: { name: "WordReference", url: "https://www.wordreference.com/fren/{term}" },
  de: { name: "WordReference", url: "https://www.wordreference.com/deen/{term}" },
  es: { name: "WordReference", url: "https://www.wordreference.com/esen/{term}" },
  it: { name: "WordReference", url: "https://www.wordreference.com/iten/{term}" },
  pt: { name: "WordReference", url: "https://www.wordreference.com/pten/{term}" },
  ru: { name: "WordReference", url: "https://www.wordreference.com/ruen/{term}" },
};

/** Wiktionaries the interface languages have; English's otherwise. */
const WIKTIONARY = new Set(["en", "vi", "es", "pt"]);

/** Where to look `term` up: the language's dictionary, then Wiktionary in the learner's language. */
export function lookups(code: string, term: string, uiLanguage: string): Lookup[] {
  const q = encodeURIComponent(term.trim());
  const primary = code.split("-")[0] ?? code;
  const wiki = WIKTIONARY.has(uiLanguage) ? uiLanguage : "en";
  const out: Lookup[] = [];
  const dict = DICTIONARIES[primary];
  if (dict) out.push({ name: dict.name, url: dict.url.replace("{term}", q) });
  out.push({ name: "Wiktionary", url: `https://${wiki}.wiktionary.org/wiki/${q}` });
  return out;
}

/** What a word's reading is called: pinyin for Chinese, furigana for Japanese. */
export function readingKind(code: string): "pinyin" | "furigana" | "reading" {
  const primary = code.split("-")[0] ?? code;
  return primary === "zh" ? "pinyin" : primary === "ja" ? "furigana" : "reading";
}

/** The picker's suggestions and the tabs' counts, as GET /v1/vocab/languages answers. */
export type SavedLanguage = { lang: string; words: number; due: number };
export type StudiedLanguages = { studied: string[]; current: string; saved: SavedLanguage[] };
