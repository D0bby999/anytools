import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/** The Loop home's way to the Toolkit (up methods, phase 0). */
export function ToolkitLink() {
  const { t } = useTranslation("toolkit");
  return (
    <section aria-labelledby="lp-loop-toolkit" className="mt-10">
      <h2 id="lp-loop-toolkit" className="lp-section">
        {t("loop.title")}
      </h2>
      <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("loop.body")}</p>
      <Link to="/toolkit" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
        {t("loop.open")}
      </Link>
    </section>
  );
}
