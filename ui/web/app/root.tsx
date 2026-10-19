import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches, useRouteLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { useNonce } from "~/lib/nonce";
import { Plate } from "~/components/ui/plate";
import { I18nextProvider } from "react-i18next";

import type { Route } from "./+types/root";
import { initI18n, isLoaded, isSupportedLng, loadLanguage, type SupportedLng } from "~/lib/i18n";
// The textbook world's three faces (ui/web/DESIGN.md): Literata titles and
// reads, Be Vietnam Pro operates, Plex Mono carries code and data. Only the
// weights the world paints. Self-hosted rather than from Google Fonts: its
// stylesheet blocked rendering for ~940 ms on a throttled phone, and the CSP
// needs no third-party font host. Each file's unicode-range includes
// Vietnamese (U+1EA0-1EF9, U+20AB), so the browser fetches that subset only
// when a page uses it.
import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/literata/800.css";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import serifSemibold from "@fontsource/literata/files/literata-latin-600-normal.woff2?url";
// KaTeX's stylesheet for rendered math (components/rich-text.tsx). Vite bundles
// the font files it references as local assets, so `font-src 'self'` holds.
import "katex/dist/katex.min.css";
import "./app.css";

export const links: Route.LinksFunction = () => [
  // The landing page's LCP is its serif h1; fetching that one face early
  // saves a round trip on a slow connection.
  { rel: "preload", href: serifSemibold, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

/** The favicons: AnyTools' four tiles, and AnyLearn's highlighted page (public/icons). */
const SITE_ICON = { svg: "/favicon.svg?v=2", ico: "/favicon.ico?v=2" };
const STUDY_ICON = { svg: "/icons/anylearn-favicon.svg?v=2", ico: "/icons/anylearn.ico?v=2" };

/** Same key and rule as useThemeAfterHydration and components/layout/theme-toggle.tsx. */
const APPLY_THEME = `document.documentElement.classList.toggle("dark",localStorage.getItem("anytools-theme")==="dark")`;

/**
 * Applies the theme again once React owns the page. When hydration fails on a
 * page (a date rendered in another zone, say), React renders it again on the
 * client and the class the pre-paint script set on <html> is gone with it.
 */
function useThemeAfterHydration() {
  useEffect(() => {
    try {
      document.documentElement.classList.toggle("dark", localStorage.getItem("anytools-theme") === "dark");
    } catch {
      // No storage (Safari private mode): the light default stands.
    }
  }, []);
}

export function Layout({ children }: { children: React.ReactNode }) {
  // The CSP nonce (entry.server.tsx). Empty in the browser, where the
  // attribute is hidden after parsing — hence suppressHydrationWarning below.
  const nonce = useNonce();
  useThemeAfterHydration();
  // The public tool pages and the landing page are in the visitor's language
  // (public.layout.tsx, landing.tsx); the app is English.
  const publicLang = useRouteLoaderData<{ locale: string }>("routes/public.layout")?.locale;
  const landingLang = useRouteLoaderData<{ toolsLocale: string }>("routes/landing")?.toolsLocale;
  // The study app's language: the account's, or the sign-in page's.
  const appLang = useAppLanguage();
  const lang = publicLang ?? landingLang ?? appLang ?? "en";
  // The tab shows whose page this is: AnyLearn's inside the study app and on
  // its sign-in, AnyTools' everywhere else. Here rather than in `links`, which
  // cannot see the route. `?v=` makes browsers drop the icon they cached.
  const study = useMatches().some((m) => m.id === "routes/app-layout" || m.id === "routes/auth-layout");
  const icon = study ? STUDY_ICON : SITE_ICON;
  return (
    <html lang={lang} data-app-lang={appLang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="icon" href={icon.svg} type="image/svg+xml" />
        <link rel="icon" href={icon.ico} sizes="16x16 32x32 48x48" />
        <Meta />
        <Links />
        <script
          nonce={nonce}
          suppressHydrationWarning
          // Applies the stored theme before first paint. Without it a dark-mode
          // user sees a white flash on every navigation that triggers a document
          // load, because React only learns the preference after hydration.
          // Light is the default (owner, 2026-10-19): only a visitor who chose
          // dark gets it, whatever the system prefers.
          dangerouslySetInnerHTML={{ __html: `(function(){try{${APPLY_THEME}}catch(e){}})()` }}
        />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

/** The language app-layout or auth-layout chose, if this page is in the study app. */
function useAppLanguage(): SupportedLng | undefined {
  const app = useRouteLoaderData<{ language?: string }>("routes/app-layout")?.language;
  const auth = useRouteLoaderData<{ language?: string }>("routes/auth-layout")?.language;
  const lang = app ?? auth;
  return lang && isSupportedLng(lang) ? lang : undefined;
}

/**
 * The i18n instance for the page's language. Synchronous on both server and
 * client, so the server-rendered HTML already contains the real text and
 * hydration has nothing to correct: the layout loaders loaded the language on
 * the server, entry.client.tsx before hydrating. A client navigation into a
 * language not loaded yet (the sign-in page's language menu) renders English
 * for the moment it takes to import it, then renders again.
 */
function useAppI18n(lang: SupportedLng) {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (isLoaded(lang)) return;
    let live = true;
    void loadLanguage(lang).then(() => live && setLoaded((n) => n + 1));
    return () => {
      live = false;
    };
  }, [lang]);
  return initI18n(lang);
}

export default function App() {
  const i18n = useAppI18n(useAppLanguage() ?? "en");

  return (
    <I18nextProvider i18n={i18n}>
      <Outlet />
    </I18nextProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let detail = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    detail = error.status === 404 ? "We could not find that page." : error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    // Stacks are shown in development only: a production stack trace tells an
    // attacker the file layout and dependency versions of the server.
    detail = error.message;
    stack = error.stack;
  }

  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      {missing && <Plate name="notfound" sizes="(min-width: 768px) 36rem, 100vw" className="mb-6" />}
      <h1 className="text-3xl leading-tight">{title}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{detail}</p>
      <p className="mt-6">
        <a href="/" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          AnyTools
        </a>
      </p>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto rounded-md bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
