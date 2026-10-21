/**
 * app-errors.tsx
 * A pathless layout around every signed-in page, for one reason: its error
 * boundary. A page whose loader or render fails is answered here, inside
 * app-layout's <main>, so the top nav and the sidebar stay and the learner
 * goes on from where they were (design audit, 2026-10-21: an error used to
 * replace the whole app with a bare page). A failure of app-layout's own
 * loader (the session) still reaches root's boundary.
 */
import { isRouteErrorResponse, Outlet, useRouteError } from "react-router";
import type { Route } from "./+types/app-errors";
import { appTitle } from "~/lib/app-title";
import { NotFound, ServerError } from "~/components/doc/not-found";

export function meta({ error, matches }: Route.MetaArgs) {
  // Without an error the page's own meta follows and replaces this; a page
  // with none keeps the title above it.
  if (!error) return matches.find((m) => m?.id === "root")?.meta ?? [];
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return [{ title: appTitle(matches, missing ? "Page not found" : "Something went wrong") }, { name: "robots", content: "noindex, nofollow" }];
}

export default function AppErrors() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <NotFound inShell />;
    return <ServerError inShell status={error.status} detail={error.statusText || undefined} />;
  }
  // Stacks in development only, as in root.tsx: a production stack tells an
  // attacker the server's file layout.
  if (import.meta.env.DEV && error instanceof Error) return <ServerError inShell detail={error.message} stack={error.stack} />;
  return <ServerError inShell />;
}
