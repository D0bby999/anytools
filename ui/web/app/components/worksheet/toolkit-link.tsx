import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/** The Loop home's way to the Toolkit (up methods, phase 0). */
export function ToolkitLink() {
  const { t } = useTranslation("toolkit");
  return (
    <section aria-labelledby="lp-loop-toolkit">
      <h2 id="lp-loop-toolkit">{t("loop.title")}</h2>
      <p>{t("loop.body")}</p>
      <p>
        <Link to="/toolkit">{t("loop.open")}</Link>
      </p>
    </section>
  );
}
