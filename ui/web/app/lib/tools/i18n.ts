/**
 * tools/i18n.ts
 * One i18next instance per public locale, for the tool pages.
 *
 * Why not the app's instance (lib/i18n.ts): on the server it is one object
 * shared by every request, and switching its language for a Vietnamese page
 * would race an English one rendering beside it. An instance per locale has a
 * fixed language, so a page only picks which one it renders under, and every
 * component below calls the plain `useTranslation("tools")`.
 *
 * English is bundled. A vi, es or pt bundle arrives in the page's loader data
 * (messages.server.ts) and is added the first time that locale renders.
 *
 * The `pages` namespace (guides, AnyProfile, the legal pages) works the same
 * way, but only the routes that use it send it: `addPagesBundle`.
 */
import { createInstance, type i18n as I18nInstance, type Resource } from "i18next";
import enCommon from "../../../public/locales/en/common.json";
import enTools from "../../../public/locales/en/tools.json";
import enPages from "../../../public/locales/en/pages.json";
import type { PublicLng } from "~/lib/i18n";

export type ToolsMessages = typeof enTools;
export type PagesMessages = typeof enPages;

const instances = new Map<PublicLng, I18nInstance>();

export function toolsI18n(locale: PublicLng, messages: ToolsMessages | null): I18nInstance {
  const existing = instances.get(locale);
  if (existing) {
    if (messages && !existing.hasResourceBundle(locale, "tools")) {
      existing.addResourceBundle(locale, "tools", messages);
    }
    return existing;
  }

  // `common` rides along in English for the shared pieces the shell reuses.
  const resources: Resource = { en: { tools: enTools, common: enCommon, pages: enPages } };
  if (locale !== "en" && messages) resources[locale] = { tools: messages };

  const instance = createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: "en",
    supportedLngs: [locale, "en"],
    ns: ["tools", "common", "pages"],
    defaultNS: "tools",
    resources,
    interpolation: { escapeValue: false },
    initImmediate: false,
    react: { useSuspense: false },
  });
  instances.set(locale, instance);
  return instance;
}

/**
 * Adds a page's `pages` bundle to its locale's instance before the page asks
 * for a string from it. The bundle is the same file every time, so adding it
 * once per process (and once per browser) is all it does.
 */
export function addPagesBundle(locale: PublicLng, messages: PagesMessages | null): void {
  const instance = toolsI18n(locale, null);
  if (messages && !instance.hasResourceBundle(locale, "pages")) {
    instance.addResourceBundle(locale, "pages", messages);
  }
}
