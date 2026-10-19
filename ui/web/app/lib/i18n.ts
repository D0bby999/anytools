/**
 * i18n.ts
 * One i18next instance, initialized SYNCHRONOUSLY from bundled resources, used
 * identically on the server and in the browser.
 *
 * Why bundled and not lazily fetched: the login page is the only page an
 * unauthenticated visitor sees, and loading translations over HTTP after
 * hydration means the server renders a spinner and the real text appears a beat
 * later. postclaw shipped exactly that (root.tsx returns a spinner until
 * initI18nClient resolves) — acceptable for a dashboard behind a login, not for
 * the page that IS the login.
 *
 * English is bundled. AnyLearn also speaks Vietnamese, Spanish and Portuguese
 * (plan 261019-1317, phase 2): those are imported per language, by the
 * server's loaders (app-layout, auth-layout) before they render and by
 * entry.client.tsx before it hydrates, so a page is translated on its first
 * paint and hydration matches. English is one instance (the global one,
 * which tests use); each other language is its own instance, made once and
 * never switched, so two requests in two languages cannot step on each other.
 */
import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "../../public/locales/en/common.json";
import enAuth from "../../public/locales/en/auth.json";
import enKnowledge from "../../public/locales/en/knowledge.json";
import enLoop from "../../public/locales/en/loop.json";
import enReading from "../../public/locales/en/reading.json";
import enStudy from "../../public/locales/en/study.json";
import enSolve from "../../public/locales/en/solve.json";
import enResearch from "../../public/locales/en/research.json";
import enVocab from "../../public/locales/en/vocab.json";
import enProfile from "../../public/locales/en/profile.json";
import enBook from "../../public/locales/en/book.json";
import enOwnVersion from "../../public/locales/en/ownversion.json";
import enToolkit from "../../public/locales/en/toolkit.json";
import enListening from "../../public/locales/en/listening.json";
import enStorage from "../../public/locales/en/storage.json";
import enBody from "../../public/locales/en/body.json";
import enTools from "../../public/locales/en/tools.json";
import enPages from "../../public/locales/en/pages.json";

export const supportedLngs = ["en", "vi", "es", "pt"] as const;
export type SupportedLng = (typeof supportedLngs)[number];

/**
 * The public tool pages (/{locale}/…) speak the same four languages. Their
 * `tools` and `pages` bundles are not here: each public page's loader sends
 * its own (lib/tools/i18n.ts).
 */
export const publicLngs = ["en", "vi", "es", "pt"] as const;
export type PublicLng = (typeof publicLngs)[number];

/**
 * Open Graph names a locale as language_TERRITORY (`og:locale`), not a bare
 * language. The Spanish copy is Spain's ("vídeo"), the Portuguese Brazil's
 * ("você").
 */
export const OG_LOCALE: Record<PublicLng, string> = { en: "en_US", vi: "vi_VN", es: "es_ES", pt: "pt_BR" };

export const fallbackLng: SupportedLng = "en";
export const defaultNS = "common";
export const ns = ["common", "auth", "knowledge", "study", "reading", "solve", "research", "loop", "vocab", "profile", "book", "ownversion", "toolkit", "listening", "storage", "body", "tools", "pages"] as const;

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    knowledge: enKnowledge,
    study: enStudy,
    reading: enReading,
    solve: enSolve,
    research: enResearch,
    loop: enLoop,
    vocab: enVocab,
    profile: enProfile,
    book: enBook,
    ownversion: enOwnVersion,
    toolkit: enToolkit,
    listening: enListening,
    storage: enStorage,
    body: enBody,
    tools: enTools,
    pages: enPages,
  },
} as const;

/** The study app's namespaces: everything but the public site's two. */
export const appNs = ns.filter((n) => n !== "tools" && n !== "pages");

/** Every locale file, imported only when its language is first needed. */
const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>("../../public/locales/*/*.json");

const loaded: Partial<Record<SupportedLng, Record<string, unknown>>> = { en: resources.en };
const instances = new Map<SupportedLng, I18nInstance>();

/** Whether a language's bundles are in memory (English always is). */
export function isLoaded(lng: SupportedLng): boolean {
  return loaded[lng] !== undefined;
}

/**
 * Imports a language's app namespaces once, and `tools` with them: the site
 * header the sign-in page shares with the public pages reads it. A missing
 * file is left out, and those strings fall back to English rather than
 * failing the page.
 */
export async function loadLanguage(lng: SupportedLng): Promise<void> {
  if (loaded[lng]) return;
  const bundles: Record<string, unknown> = {};
  await Promise.all(
    [...appNs, "tools"].map(async (n) => {
      const file = localeFiles[`../../public/locales/${lng}/${n}.json`];
      if (file) bundles[n] = (await file()).default;
    }),
  );
  loaded[lng] = bundles;
}

export function isSupportedLng(lng: string): lng is SupportedLng {
  return (supportedLngs as readonly string[]).includes(lng);
}

export function isPublicLng(lng: string): lng is PublicLng {
  return (publicLngs as readonly string[]).includes(lng);
}

/**
 * Returns a ready instance. Synchronous by design: an async init would make the
 * first server render arrive before the translations, which is the problem this
 * module exists to avoid.
 */
export function initI18n(locale: SupportedLng = fallbackLng): I18nInstance {
  const bundles = loaded[locale];
  if (locale !== fallbackLng && bundles) {
    let instance = instances.get(locale);
    if (!instance) {
      instance = i18next.createInstance();
      void instance.init({
        lng: locale,
        fallbackLng,
        defaultNS,
        ns: [...ns],
        supportedLngs: [...supportedLngs],
        resources: { en: resources.en, [locale]: bundles } as never,
        interpolation: { escapeValue: false },
        initImmediate: false,
        react: { useSuspense: false },
      });
      instances.set(locale, instance);
    }
    return instance;
  }
  // The global instance is English and stays English: a language whose
  // bundles are not loaded yet falls back here rather than switching it.
  if (!i18next.isInitialized) {
    void i18next.use(initReactI18next).init({
      lng: fallbackLng,
      fallbackLng,
      defaultNS,
      ns: [...ns],
      supportedLngs: [...supportedLngs],
      resources,
      interpolation: { escapeValue: false },
      // React already escapes; initImmediate: false keeps init synchronous so
      // the instance is usable on the very next line during SSR.
      initImmediate: false,
      react: { useSuspense: false },
    });
  }
  return i18next;
}
