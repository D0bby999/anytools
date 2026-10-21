import { QuickStart } from "~/components/doc/quick-start";
import { Details } from "~/components/doc/details";
/**
 * mastery.decks.tsx
 * Mastery → Decks (the private design notes, phase 5;
 * ux/05-decks.md): today's cards from the learner's general decks, one
 * queue for all of them; the decks with their counts; a library of ready
 * decks, the free ones added in one tap; and an Anki or CrowdAnki file read
 * in the browser and sent as cards (routes/mastery.decks.import.ts).
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/mastery.decks";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { dueCards, reviewCard } from "~/lib/vocab.server";
import { addLibraryDeck, deleteDeck, listDecks } from "~/lib/decks.server";
import { RATINGS, type Rating } from "~/lib/vocab-types";
import { MasteryTabs } from "~/components/vocab/mastery-tabs";
import { ReviewSession } from "~/components/vocab/review-session";
import { DeckImport, DeckLibrary, DeckList } from "~/components/vocab/decks";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Decks") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [due, decks, vocabDue, bookDue] = await Promise.all([
    dueCards(user.id, undefined, "cards"),
    listDecks(user.id).then((d) => d.decks),
    dueCards(user.id, 0).then((d) => d.due_count).catch((): number | null => null),
    dueCards(user.id, 0, "book").then((d) => d.due_count).catch((): number | null => null),
  ]);
  return { cards: due.cards, dueCount: due.due_count, decks, vocabDue, bookDue };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "review": {
        const rating = String(form.get("rating") ?? "") as Rating;
        if (!RATINGS.includes(rating)) return { errorKey: "errors.generic" };
        const cardId = String(form.get("card_id") ?? "");
        await reviewCard(user.id, cardId, { rating, request_id: String(form.get("request_id") ?? "") });
        return { reviewed: cardId };
      }
      case "delete": {
        const id = String(form.get("id") ?? "");
        await deleteDeck(user.id, id);
        return { deleted: id };
      }
      case "library": {
        const added = await addLibraryDeck(user.id, String(form.get("slug") ?? ""));
        if (!added) return { errorKey: "errors.generic" };
        return { added: { name: added.deck.name, ...added.totals } };
      }
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic" };
}

export default function Decks({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("vocab");
  const { cards, dueCount, decks, vocabDue, bookDue } = loaderData;
  return (
    <div className="lp-doc lp-measure">
      <PageHeader title={t("decks.title")} lede={t("decks.lead")} />
      <MasteryTabs vocabDue={vocabDue} bookDue={bookDue} deckDue={dueCount} />
      <QuickStart kicker={t("session.title")} title={t("practise.reviewCards", { count: dueCount })} primary={{ to: "#lp-decks-due", label: t("session.title") }} />

      <section aria-labelledby="lp-decks-due" className="mt-8">
        <h2 id="lp-decks-due" className="lp-section">
          {t("session.title")}
        </h2>
        {decks.length === 0 ? (
          <p className="mt-3 lp-empty">{t("decks.noCards")}</p>
        ) : (
          <ReviewSession cards={cards} total={dueCount} />
        )}
      </section>

      {decks.length > 0 ? (
        <section aria-labelledby="lp-decks-mine" className="mt-10">
          <h2 id="lp-decks-mine" className="lp-section">
            {t("decks.mine")}
          </h2>
          <DeckList decks={decks} />
        </section>
      ) : null}

      <section aria-labelledby="lp-decks-library" className="mt-10">
        <h2 id="lp-decks-library" className="lp-section">
          {t("decks.library.title")}
        </h2>
        <DeckLibrary decks={decks} />
        <p className="mt-3 text-sm">
          <Link to="/library" className="text-primary underline underline-offset-4">
            {t("decks.library.more")}
          </Link>
        </p>
      </section>

      <div id="lp-decks-file"><Details summary={t("decks.file.title")}>
        <DeckImport />
      </Details></div>
    </div>
  );
}
