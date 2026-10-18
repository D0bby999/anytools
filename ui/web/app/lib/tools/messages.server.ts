/**
 * tools/messages.server.ts
 * The vi, es and pt `tools` bundles, kept on the server: a public page's loader
 * returns the one its locale needs, so no page ships all four.
 */
import viTools from "../../../public/locales/vi/tools.json";
import esTools from "../../../public/locales/es/tools.json";
import ptTools from "../../../public/locales/pt/tools.json";
import viPages from "../../../public/locales/vi/pages.json";
import esPages from "../../../public/locales/es/pages.json";
import ptPages from "../../../public/locales/pt/pages.json";
import type { PublicLng } from "~/lib/i18n";
import type { PagesMessages, ToolsMessages } from "./i18n";

const BUNDLES: Record<Exclude<PublicLng, "en">, ToolsMessages> = {
  vi: viTools as ToolsMessages,
  es: esTools as ToolsMessages,
  pt: ptTools as ToolsMessages,
};

/** Null for English, which every page already carries. */
export function toolsMessages(locale: PublicLng): ToolsMessages | null {
  return locale === "en" ? null : BUNDLES[locale];
}

const PAGES: Record<Exclude<PublicLng, "en">, PagesMessages> = {
  vi: viPages as PagesMessages,
  es: esPages as PagesMessages,
  pt: ptPages as PagesMessages,
};

/** The `pages` bundle for the routes that use it (guides, AnyProfile, legal); null for English. */
export function pagesMessages(locale: PublicLng): PagesMessages | null {
  return locale === "en" ? null : PAGES[locale];
}
