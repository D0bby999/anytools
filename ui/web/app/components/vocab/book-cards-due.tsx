import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/**
 * Home's book-cards line (learning depth, phase 11): shown only when a living
 * book's flash cards are due, so a learner who has made no book sees nothing.
 */
export function BookCardsDue({ count }: { count: number }) {
  const { t } = useTranslation("vocab");
  if (count <= 0) return null;
  return (
    <section aria-labelledby="lp-book-cards-home" className="mt-10">
      <h2 id="lp-book-cards-home" className="lp-kicker">
        {t("bookCards.home.title")}
      </h2>
      <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("bookCards.home.count", { count })}</p>
      <Link
        to="/mastery/book-cards"
        className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        {t("bookCards.home.open")}
      </Link>
    </section>
  );
}
