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
    <section aria-labelledby="lp-book-cards-home">
      <h3 id="lp-book-cards-home" className="font-sans text-sm font-semibold">
        {t("bookCards.home.title")}
      </h3>
      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t("bookCards.home.count", { count })}</p>
      <Link
        to="/mastery/book-cards"
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
      >
        {t("bookCards.home.open")}
      </Link>
    </section>
  );
}
