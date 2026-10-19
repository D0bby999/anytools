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
import { appTitle } from "~/lib/app-title";
import { configuredProviders, localSignInEnabled } from "~/lib/env.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";
import { Button } from "~/components/ui/button";
import { PARTS } from "~/lib/parts";
import { Plate } from "~/components/ui/plate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Alert } from "~/components/ui/alert";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Sign in") },
    { name: "description", content: "Sign in to AnyLearn with Google or GitHub." },
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
    <main className="grid overflow-hidden rounded-xl border bg-card shadow-md lg:grid-cols-[1.1fr_1fr]">
      {/* The book's cover: the only page an outside visitor sees before the
          shell, so the wordmark is the loudest thing on it, the plate sets the
          desk, and the four parts say what is inside. */}
      <div className="bg-muted px-6 py-8 sm:px-10 sm:py-10">
        <Plate name="signin" priority sizes="(min-width: 1024px) 34vw, 100vw" className="mx-auto hidden max-w-sm sm:block" />
        <p translate="no" className="font-serif text-4xl font-semibold tracking-display sm:mt-2 sm:text-5xl">
          {tc("app.name")}
        </p>
        <p className="mt-3 max-w-[30ch] font-serif text-lg leading-snug text-muted-foreground italic">{tc("app.tagline")}</p>
        <ol className="mt-8 hidden space-y-3 sm:block">
          {PARTS.map((part) => (
            <li key={part.id} data-part={part.id} className="flex items-baseline gap-3">
              <span aria-hidden="true" className="lp-tab min-w-8 justify-center">
                {part.numeral}
              </span>
              <span>
                <span className="font-semibold text-part">{tc(part.labelKey)}</span>
                <span className="text-muted-foreground"> · {tc(part.bodyKey)}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <Card className="flex flex-col justify-center rounded-none border-0 py-4 shadow-none sm:px-4">
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

