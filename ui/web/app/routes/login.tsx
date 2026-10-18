/**
 * login.tsx
 * The only unauthenticated page in the app.
 *
 * Sign-in is a plain link to a server route, not a fetch: the OAuth dance is a
 * sequence of top-level browser redirects, and it must survive JavaScript being
 * unavailable or still loading.
 */
import { Form, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/login";
import { configuredProviders, localSignInEnabled } from "~/lib/env.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert } from "~/components/ui/alert";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Sign in · AnyTools" },
    { name: "description", content: "Sign in to AnyTools with Google or GitHub." },
    // The app is behind a login; keep it out of search indexes entirely.
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return {
    providers: configuredProviders(),
    localSignIn: localSignInEnabled(),
    // Sanitized on the way in as well as on the way out: this value is
    // interpolated into the sign-in hrefs below.
    next: sanitizeNextPath(url.searchParams.get("next")),
  };
}

/** Maps a `?error=` code to the auth namespace key holding its copy. */
const ERROR_KEYS: Record<string, string> = {
  email_taken: "errors.emailTaken",
  email_unverified: "errors.emailUnverified",
  state_mismatch: "errors.stateMismatch",
  exchange_failed: "errors.exchangeFailed",
  not_configured: "errors.notConfigured",
  generic: "errors.generic",
};

export default function Login({ loaderData }: Route.ComponentProps) {
  const { providers, next, localSignIn } = loaderData;
  const { t } = useTranslation("auth");
  const { t: tc } = useTranslation("common");
  const [searchParams] = useSearchParams();

  const errorCode = searchParams.get("error");
  const errorKey = errorCode ? (ERROR_KEYS[errorCode] ?? ERROR_KEYS.generic) : null;
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    // A landmark, not a fragment: auth-layout.tsx wraps this in plain divs, so
    // without it the sign-in page has no <main> and every element on it sits
    // outside any landmark. axe flags both (landmark-one-main, region).
    <main>
      {/* The only page an outside visitor sees before the shell, so it is the
          only place the wordmark gets to be the loudest thing. Serif, because
          the world's voice is a book's. */}
      <div className="mb-8 text-center">
        <p translate="no" className="font-serif text-2xl font-semibold">
          {tc("app.name")}
        </p>
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{tc("app.tagline")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.subtitle")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {errorKey && <Alert variant="destructive">{t(errorKey)}</Alert>}

          {localSignIn ? (
            // Development only (ANYTOOLS_DEV_LOGIN=1 on localhost). A form,
            // so it is a POST through the same-origin check.
            <Form method="post" action="/auth/local">
              <Button type="submit" size="lg" className="w-full">
                {t("login.local")}
              </Button>
              <p className="mt-2 text-xs leading-prose text-muted-foreground">{t("login.localNote")}</p>
            </Form>
          ) : null}

          {providers.length === 0 && localSignIn ? null : providers.length === 0 ? (
            <Alert>{t("login.noProviders")}</Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {providers.includes("google") && (
                <Button asChild variant="outline" size="lg">
                  {/* A real navigation, not a router link: /auth/google is a
                      server route that responds with a redirect off-origin. */}
                  <a href={`/auth/google${suffix}`}>{t("login.google")}</a>
                </Button>
              )}
              {providers.includes("github") && (
                <Button asChild variant="outline" size="lg">
                  <a href={`/auth/github${suffix}`}>{t("login.github")}</a>
                </Button>
              )}
            </div>
          )}

          <p className="text-xs leading-prose text-muted-foreground">{t("login.footer")}</p>
        </CardContent>
      </Card>
    </main>
  );
}

