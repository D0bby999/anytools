/**
 * mastery.book-cards.tsx
 * Mastery → Book cards: today's flash cards from the learner's living books
 * (learning depth, phase 11).
 *
 * They are rows of the vocabulary's own card table, scheduled by the same
 * FSRS settings and reviewed through the same route, but in a deck of their
 * own: the Vocabulary queue never shows them, and this one shows nothing else.
 * A flash-card block's "Add to review" is what puts its cards here.
 */
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/mastery.book-cards";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { dueCards, reviewCard } from "~/lib/vocab.server";
import { RATINGS, type Rating } from "~/lib/vocab-types";
import { MasteryTabs } from "~/components/vocab/mastery-tabs";
import { ReviewSession } from "~/components/vocab/review-session";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Book cards") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [due, vocabDue] = await Promise.all([
    dueCards(user.id, undefined, "book"),
    dueCards(user.id, 0).then((d) => d.due_count).catch((): number | null => null),
  ]);
  return { cards: due.cards, dueCount: due.due_count, vocabDue };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "review") return { errorKey: "errors.generic" };
  const rating = String(form.get("rating") ?? "") as Rating;
  if (!RATINGS.includes(rating)) return { errorKey: "errors.generic" };
  const cardId = String(form.get("card_id") ?? "");
  try {
    await reviewCard(user.id, cardId, { rating, request_id: String(form.get("request_id") ?? "") });
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { reviewed: cardId };
}

export default function BookCards({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("vocab");
  return (
    <div className="lp-measure">
      <PageHeader title={t("bookCards.title")} lede={t("bookCards.lead")} />
      <MasteryTabs vocabDue={loaderData.vocabDue} bookDue={loaderData.dueCount} />
      <section aria-labelledby="lp-book-cards-due" className="mt-8">
        <h2 id="lp-book-cards-due" className="lp-section">
          {t("session.title")}
        </h2>
        <ReviewSession cards={loaderData.cards} total={loaderData.dueCount} />
      </section>
    </div>
  );
}
