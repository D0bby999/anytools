import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import { useNonce } from "~/lib/nonce";
import { I18nextProvider } from "react-i18next";

import type { Route } from "./+types/root";
import { initI18n } from "~/lib/i18n";
// IBM Plex, three cuts: serif reads, sans operates, mono labels regions
// (ui/web/DESIGN.md). Only the weights the world actually uses. Self-hosted
// rather than from Google Fonts: its stylesheet blocked rendering for ~940 ms
// on a throttled phone (two extra origins), and the CSP no longer needs a
// third-party font host. Each file's unicode-range includes Vietnamese
// (U+1EA0-1EF9, U+20AB), so the browser fetches that subset only when a page
// uses it — the ucdaigym bug was a display face with no Vietnamese glyphs.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-serif/400.css";
import "@fontsource/ibm-plex-serif/400-italic.css";
import "@fontsource/ibm-plex-serif/600.css";
import "@fontsource/ibm-plex-mono/600.css";
import serifSemibold from "@fontsource/ibm-plex-serif/files/ibm-plex-serif-latin-600-normal.woff2?url";
// KaTeX's stylesheet for rendered math (components/rich-text.tsx). Vite bundles
// the font files it references as local assets, so `font-src 'self'` holds.
import "katex/dist/katex.min.css";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  // The landing page's LCP is its serif h1; fetching that one face early
  // saves a round trip on a slow connection.
  { rel: "preload", href: serifSemibold, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // The CSP nonce (entry.server.tsx). Empty in the browser, where the
  // attribute is hidden after parsing — hence suppressHydrationWarning below.
  const nonce = useNonce();
  // The public tool pages are in the visitor's language (public.layout.tsx);
  // the app is English.
  const lang = useRouteLoaderData<{ locale: string }>("routes/public.layout")?.locale ?? "en";
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <Meta />
        <Links />
        <script
          nonce={nonce}
          suppressHydrationWarning
          // Applies the stored theme before first paint. Without it a dark-mode
          // user sees a white flash on every navigation that triggers a document
          // load, because React only learns the preference after hydration.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("anytools-theme");if(t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
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

export default function App() {
  // Synchronous on both server and client, so the server-rendered HTML already
  // contains the real text and hydration has nothing to correct.
  const i18n = initI18n();

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

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{detail}</p>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto rounded-md bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
