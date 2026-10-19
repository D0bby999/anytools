/**
 * auth-layout.tsx
 * Shell for the signed-out pages. Redirects an already-signed-in visitor away,
 * so /login never renders for someone who has a session.
 */
import { data, Outlet, redirect } from "react-router";
import type { Route } from "./+types/auth-layout";
import { getUserId } from "~/lib/auth.server";
import { loadLanguage } from "~/lib/i18n";
import { languageCookie, visitorLanguage } from "~/lib/language.server";
import { SiteHeader } from "~/components/layout/site-header";
import { PWA_LINKS } from "~/lib/pwa";

/** Sign-in is the study app's door, so it can be installed from here too. */
export const links: Route.LinksFunction = () => PWA_LINKS;

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) throw redirect("/home");
  // The sign-in page speaks the visitor's language, and remembers it so a
  // new account starts in it (app-layout reads the cookie once).
  const language = await visitorLanguage(request);
  await loadLanguage(language);
  return data({ language }, { headers: { "Set-Cookie": await languageCookie.serialize(language) } });
}

/**
 * The site header over sign-in, as on every public page, in the visitor's
 * language. Its language menu reloads sign-in in another one (`?lang=`), and
 * there is no "Sign in" button on the page that is the sign-in.
 */
export default function AuthLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader locale={loaderData.language} languageHref={(l) => `/login?lang=${l}`} signIn={false} />
      <div className="flex flex-1 items-center justify-center px-4 py-10 lg:px-8">
        <div className="w-full max-w-5xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
