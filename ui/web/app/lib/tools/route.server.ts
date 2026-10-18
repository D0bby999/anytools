/**
 * tools/route.server.ts
 * What every public tool page's loader starts with. Loaders of nested routes
 * run in parallel, not after the layout's, so each one checks its own locale.
 */
import type { TFunction } from "i18next";
import { isPublicLng, type PublicLng } from "~/lib/i18n";
import { addPagesBundle, toolsI18n } from "./i18n";
import { pagesMessages, toolsMessages } from "./messages.server";

/** The locale segment, or a 404 for anything that is not one of the four. */
export function publicLocale(params: { locale?: string }): PublicLng {
  const locale = params.locale ?? "";
  if (!isPublicLng(locale)) throw new Response("Not found", { status: 404 });
  return locale;
}

export function notFound(): never {
  throw new Response("Not found", { status: 404 });
}

/** The `tools` strings in a locale, for text a loader computes (titles, descriptions). */
export function toolsT(locale: PublicLng): TFunction<"tools"> {
  return toolsI18n(locale, toolsMessages(locale)).getFixedT(locale, "tools");
}

/** The `pages` strings in a locale (guides, AnyProfile, legal), for the same use. */
export function pagesT(locale: PublicLng): TFunction<"pages"> {
  const instance = toolsI18n(locale, toolsMessages(locale));
  addPagesBundle(locale, pagesMessages(locale));
  return instance.getFixedT(locale, "pages");
}
