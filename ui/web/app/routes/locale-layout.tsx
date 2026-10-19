/**
 * locale-layout.tsx
 * Keeps the document's lang attribute in step with the active i18n language,
 * or with the landing page's own, which is the visitor's (landing.tsx).
 */
import { Outlet, useRouteLoaderData } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function LocaleLayout() {
  const { i18n } = useTranslation();
  const lang = useRouteLoaderData<{ toolsLocale: string }>("routes/landing")?.toolsLocale ?? i18n.language;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return <Outlet />;
}
