import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/** Home's vocabulary line: how many word cards are due today, and the way in. */
export function VocabDue({ count }: { count: number }) {
  const { t } = useTranslation("vocab");
  return (
    <section aria-labelledby="lp-vocab-home" className="mt-10">
      <h2 id="lp-vocab-home" className="lp-kicker">
        {t("home.title")}
      </h2>
      <p className="mt-3 text-sm leading-prose text-muted-foreground">
        {count > 0 ? t("home.count", { count }) : t("home.none")}
      </p>
      <Link
        to="/mastery/vocabulary"
        className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        {t("home.open")}
      </Link>
    </section>
  );
}
