import { useTranslation } from "react-i18next";

/**
 * The 404 page, VitePress's NotFound.vue: the code, "PAGE NOT FOUND" in
 * spaced capitals, a short rule, up's line about the road, and one way home.
 * A full document of its own: root.tsx renders it when no route matched.
 */
/**
 * Any other error, in the 404's frame: the page's own title, what happened in
 * one sentence, and the way back to Today. A development build adds the
 * stack below, scrollable and reachable by keyboard.
 */
export function ServerError({
  status,
  detail,
  stack,
  inShell = false,
}: {
  status?: number;
  detail?: string;
  stack?: string;
  /** Inside the app's shell (routes/app-errors.tsx): its <main> holds this, and its meta names the tab. */
  inShell?: boolean;
}) {
  const { t } = useTranslation("common");
  const title = status ? t("serverError.status", { status }) : t("serverError.title");
  const Frame = inShell ? "div" : "main";
  return (
    <Frame className="lp-not-found">
      {inShell ? null : <title>{`${title} · AnyLearn`}</title>}
      <p className="lp-not-found-code" aria-hidden="true">
        {status ?? 500}
      </p>
      <h1 className="lp-not-found-title">{title}</h1>
      <div className="lp-not-found-divider" aria-hidden="true" />
      <blockquote className="lp-not-found-quote">{detail || t("serverError.body")}</blockquote>
      <div className="lp-not-found-action">
        <a className="lp-not-found-link" href="/home">
          {t("notFound.home")}
        </a>
      </div>
      {stack ? (
        <pre tabIndex={0} className="mt-6 w-full overflow-x-auto rounded-md bg-muted p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </Frame>
  );
}

export function NotFound({ inShell = false }: { inShell?: boolean }) {
  const { t } = useTranslation("common");
  const Frame = inShell ? "div" : "main";
  return (
    <Frame className="lp-not-found">
      {/* React hoists it to <head>: a tab says what happened, as every page's
          does. In the shell the route's meta names the tab instead. */}
      {inShell ? null : <title>{`${t("notFound.title")} · AnyLearn`}</title>}
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
    </Frame>
  );
}
