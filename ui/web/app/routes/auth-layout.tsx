/**
 * auth-layout.tsx
 * Shell for the signed-out pages. Redirects an already-signed-in visitor away,
 * so /login never renders for someone who has a session.
 */
import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/auth-layout";
import { getUserId } from "~/lib/auth.server";
import { SiteHeader } from "~/components/layout/site-header";
import { PWA_LINKS } from "~/lib/pwa";

/** Sign-in is the study app's door, so it can be installed from here too. */
export const links: Route.LinksFunction = () => PWA_LINKS;

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) throw redirect("/home");
  return null;
}

/**
 * The site header over sign-in, as on every public page. The study app is in
 * English, so it has no language menu here, and no "Sign in" button on the
 * page that is the sign-in.
 */
export default function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader locale="en" languages={false} signIn={false} />
      <div className="flex flex-1 items-center justify-center px-4 py-10 lg:px-8">
        <div className="w-full max-w-5xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
