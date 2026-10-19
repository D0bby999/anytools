/**
 * app-title.ts
 * A study-app page's <title>, in the page's language: its parts, then
 * "AnyLearn", joined by " · ". A plain string is a section's English name and
 * is translated (common.json → `titles`); `raw()` marks a learner's own words
 * (a knowledge base's name, a chat's title) that are never translated.
 */
import { initI18n, isLoaded, isSupportedLng, type SupportedLng } from "~/lib/i18n";

type Match = { id: string; data?: unknown } | undefined;
type Part = string | { raw: string };

/** A learner's own words in a title, kept as they are. */
export function raw(text: string): Part {
  return { raw: text };
}

function languageOf(matches: readonly Match[]): SupportedLng {
  for (const id of ["routes/app-layout", "routes/auth-layout"]) {
    const data = matches.find((m) => m?.id === id)?.data as { language?: string } | undefined;
    if (data?.language && isSupportedLng(data.language) && isLoaded(data.language)) return data.language;
  }
  return "en";
}

export function appTitle(matches: readonly Match[], ...parts: Part[]): string {
  const lang = languageOf(matches);
  const t = initI18n(lang).getFixedT(lang, "common", "titles");
  const words = parts.map((p) => (typeof p === "string" ? t(p, { defaultValue: p }) : p.raw));
  return [...words, "AnyLearn"].join(" · ");
}
