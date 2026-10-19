/**
 * public.layout.tsx
 * `/{locale}`: the frame of the public tool pages, in en, vi, es or pt, with
 * no sign-in. It sits outside locale-layout and app-layout on purpose: those
 * set the document's language to the app's English and guard the session,
 * and neither applies here. Any other first segment is a 404.
 */
import { I18nextProvider } from "react-i18next";
import { isRouteErrorResponse, Link, Outlet, useLoaderData, useRouteError, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/public.layout";
import { PublicShell } from "~/components/tools-site/public-shell";
import { Plate } from "~/components/ui/plate";
import { toolsI18n } from "~/lib/tools/i18n";
import { toolsMessages } from "~/lib/tools/messages.server";
import { publicLocale } from "~/lib/tools/route.server";

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  return { locale, messages: toolsMessages(locale) };
}

export default function PublicLayout() {
  const { locale, messages } = useLoaderData<typeof loader>();
  return (
    <I18nextProvider i18n={toolsI18n(locale, messages)}>
      <PublicShell locale={locale}>
        <Outlet />
      </PublicShell>
    </I18nextProvider>
  );
}

/**
 * An unknown cluster or tool: the shell stays, in the visitor's language.
 * An unknown locale never reaches the shell (its loader is the one that
 * failed), and gets the plain English page.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("routes/public.layout");
  const missing = isRouteErrorResponse(error) && error.status === 404;
  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        {missing && <Plate name="notfound" sizes="(min-width: 768px) 36rem, 100vw" className="mb-6" />}
        <h1 className="text-3xl leading-tight">{missing ? "Page not found" : "Something went wrong"}</h1>
        <p className="mt-4">
          <Link to="/en" className="text-primary underline">
            AnyTools
          </Link>
        </p>
      </main>
    );
  }
  const t = toolsI18n(data.locale, data.messages).getFixedT(data.locale, "tools");
  return (
    <I18nextProvider i18n={toolsI18n(data.locale, data.messages)}>
      <PublicShell locale={data.locale}>
        <div className="lp-measure px-4 py-12">
          {missing && <Plate name="notfound" sizes="(min-width: 768px) 36rem, 100vw" className="mb-6 max-w-xl" />}
          <h1 className="text-3xl leading-tight lg:text-4xl">{missing ? t("notFound.title") : t("error.title")}</h1>
          <p className="mt-3 text-lg leading-snug text-muted-foreground">
            {missing ? t("notFound.description") : t("error.description")}
          </p>
          <p className="mt-6">
            <Link to={`/${data.locale}`} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
              {t("notFound.ctaHome")}
            </Link>
          </p>
        </div>
      </PublicShell>
    </I18nextProvider>
  );
}

export function meta() {
  // Children set their own; an error page is never for the index.
  return [{ title: "AnyTools" }, { name: "robots", content: "noindex, follow" }];
}
