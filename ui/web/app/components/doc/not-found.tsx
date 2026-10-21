import { useTranslation } from "react-i18next";

/**
 * The 404 page, VitePress's NotFound.vue: the code, "PAGE NOT FOUND" in
 * spaced capitals, a short rule, up's line about the road, and one way home.
 * A full document of its own: root.tsx renders it when no route matched.
 */
export function NotFound() {
  const { t } = useTranslation("common");
  return (
    <main className="lp-not-found">
      <p className="lp-not-found-code" aria-hidden="true">
        404
      </p>
      <h1 className="lp-not-found-title">{t("notFound.title")}</h1>
      <div className="lp-not-found-divider" aria-hidden="true" />
      <blockquote className="lp-not-found-quote">{t("notFound.quote")}</blockquote>
      <div className="lp-not-found-action">
        <a className="lp-not-found-link" href="/home">
          {t("notFound.home")}
        </a>
      </div>
    </main>
  );
}
