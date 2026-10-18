import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/** Home's vocabulary line: how many word cards are due today, and the way in. */
export function VocabDue({ count }: { count: number }) {
  const { t } = useTranslation("vocab");
  return (
    <section aria-labelledby="lp-vocab-home">
      <h3 id="lp-vocab-home" className="font-sans text-sm font-semibold">
        {t("home.title")}
      </h3>
      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
        {count > 0 ? t("home.count", { count }) : t("home.none")}
      </p>
      <Link
        to="/mastery/vocabulary"
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
      >
        {t("home.open")}
      </Link>
    </section>
  );
}
