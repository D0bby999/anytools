import { Link } from "react-router";
import { useTranslation } from "react-i18next";

/**
 * "Review everything due (N)" — the way into the cross-path review
 * (up-methods phase 12), on Home and on /mastery. Shown only when what is due
 * spans two or more paths: with one path, that path's own session is the
 * same thing.
 */
export function ReviewAllLink({ count, paths }: { count: number; paths: number }) {
  const { t } = useTranslation("study");
  if (count <= 0 || paths < 2) return null;
  // A block of its own, so it sits under the link beside it on Home rather
  // than running on from it.
  return (
    <p className="mt-2">
      <Link
        to="/mastery/review"
        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        {t("review.openAll", { count })}
      </Link>
    </p>
  );
}

/** How many distinct paths a due list spans. */
export function duePathCount(items: readonly { path_id: string }[]): number {
  return new Set(items.map((item) => item.path_id)).size;
}
