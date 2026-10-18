/**
 * locale-layout.tsx
 * Keeps the document's lang attribute in step with the active i18n language.
 */
import { Outlet } from "react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function LocaleLayout() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return <Outlet />;
}
