import { QuickStart } from "~/components/doc/quick-start";
import { Details } from "~/components/doc/details";
/**
 * mastery.vocabulary.tsx
 * Mastery → Vocabulary: today's word cards and the word list.
 *
 * Words are saved from Reading (a vocabulary answer's "Find words to save");
 * nothing here calls a model. Since up-methods phase 3 each word carries one
 * of up's five decisions: words to learn are reviewed as before, the others
 * are listed with their records and a "Learn this", a word being learned can
 * get a production card ("Practise using it"), and words can be copied into
 * an open vocabulary audit's decision queue. Each word is a note with a recognition card and
 * a cloze card on their own FSRS schedule; reviewing one card buries its
 * sibling until tomorrow in the learner's zone, so the session never shows the
 * answer to the next card.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/mastery.vocabulary";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { deleteWord, dueCards, listWords, practiseWord, reviewCard, updateWord } from "~/lib/vocab.server";
import { appendRow, listWorksheets } from "~/lib/worksheets.server";
import { auditRow, decisionBody, RATINGS, type Rating } from "~/lib/vocab-types";
import { MasteryTabs } from "~/components/vocab/mastery-tabs";
import { ReviewSession } from "~/components/vocab/review-session";
import { WordList } from "~/components/vocab/word-list";
import { AnkiExport, AnkiImport } from "~/components/vocab/anki-decks";
import { PageHeader } from "~/components/ui/page-header";
import { languageNameInSentence } from "~/lib/languages";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Vocabulary") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lang = (url.searchParams.get("lang") ?? "").trim();
  const [due, words, all, bookDue, audits] = await Promise.all([
    // A language's "Review these" (routes/languages.$lang.tsx) narrows the
    // session to that language, as it narrows the list.
    dueCards(user.id, undefined, "words", lang),
    listWords(user.id, { q, lang }),
    // The language filter lists the languages the learner actually has.
    q || lang ? listWords(user.id) : Promise.resolve(null),
    dueCards(user.id, 0, "book").then((d) => d.due_count).catch((): number | null => null),
    // "Add to a vocabulary audit" offers the learner's open audits.
    listWorksheets(user.id, { kind: "vocabulary_audit" })
      .then((ws) => ws.filter((w) => w.status === "open"))
      .catch(() => []),
  ]);
  const langs = [...new Set((all ?? words).notes.map((n) => n.lang))].sort();
  return { cards: due.cards, dueCount: due.due_count, notes: words.notes, q, lang, langs, bookDue, audits };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  try {
    switch (intent) {
      case "review": {
        const rating = String(form.get("rating") ?? "") as Rating;
        if (!RATINGS.includes(rating)) return { errorKey: "errors.generic" };
        const cardId = String(form.get("card_id") ?? "");
        await reviewCard(user.id, cardId, {
          rating,
          answer: String(form.get("answer") ?? ""),
          request_id: String(form.get("request_id") ?? ""),
        });
        return { reviewed: cardId };
      }
      case "update":
        await updateWord(user.id, id, {
          meaning: String(form.get("meaning") ?? ""),
          reading: String(form.get("reading") ?? ""),
          pos: String(form.get("pos") ?? ""),
          lang: String(form.get("lang") ?? ""),
        });
        return { updated: id };
      case "suspend":
        await updateWord(user.id, id, { suspended: form.get("suspended") === "true" });
        return { updated: id };
      case "delete":
        await deleteWord(user.id, id);
        return { deleted: id };
      // up-methods phase 3.
      case "decide": {
        const decided = decisionBody(form);
        if (!decided) return { errorKey: "errors.generic" };
        const { week } = await updateWord(user.id, id, decided);
        return { updated: id, week };
      }
      case "practise":
        await practiseWord(user.id, id, {
          scenario: String(form.get("scenario") ?? ""),
          confusable: String(form.get("confusable") ?? ""),
        });
        return { updated: id };
      case "production-off":
        await updateWord(user.id, id, { production: false });
        return { updated: id };
      case "listening":
        await updateWord(user.id, id, { listening: String(form.get("on")) === "true" });
        return { updated: id };
      case "writing":
        await updateWord(user.id, id, { writing: String(form.get("on")) === "true" });
        return { updated: id };
      case "audit":
        return await copyToAudit(user.id, String(form.get("worksheet") ?? ""), form.getAll("note").map(String));
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic" };
}

/**
 * Copies the selected notes into the audit's §3 decision queue, one row
 * append each, in the order they are listed. The worksheet resolves with the
 * learner's id on the API; a full queue (400) stops the copy and says how
 * many went in.
 */
async function copyToAudit(userId: string, worksheetId: string, ids: string[]) {
  if (ids.length === 0) return { errorKey: "audit.nothing" };
  const wanted = new Set(ids);
  const notes = (await listWords(userId)).notes.filter((n) => wanted.has(n.id));
  let added = 0;
  for (const note of notes) {
    try {
      await appendRow(userId, worksheetId, { section: "queue", field: "items", row: auditRow(note) });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && added > 0) return { auditAdded: added, auditFull: true };
      throw error;
    }
    added++;
  }
  return { auditAdded: added };
}

export default function Vocabulary({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("vocab");
  return (
    <div className="lp-doc lp-measure">
      <PageHeader title={t("page.title")} lede={t("page.lead")} />
      <MasteryTabs vocabDue={loaderData.dueCount} bookDue={loaderData.bookDue} />
      <QuickStart title={t("practise.reviewWords", { count: loaderData.dueCount })} primary={{ to: "#lp-vocab-due", label: t("session.title") }} />

      <section aria-labelledby="lp-vocab-due" className="mt-8">
        <h2 id="lp-vocab-due" className="lp-section">
          {t("session.title")}
        </h2>
        {loaderData.lang ? (
          <p className="mt-1 text-sm leading-prose text-muted-foreground">
            {t("session.onlyLang", { name: languageNameInSentence(loaderData.lang, i18n.language) })}{" "}
            <Link to="/mastery/vocabulary" className="text-primary underline underline-offset-4">
              {t("session.allLangs")}
            </Link>
          </p>
        ) : null}
        <ReviewSession key={loaderData.lang} cards={loaderData.cards} total={loaderData.dueCount} />
      </section>

      <section aria-labelledby="lp-vocab-words" className="mt-10">
        <h2 id="lp-vocab-words" className="lp-section">
          {t("list.title")}
        </h2>
        <WordList
          notes={loaderData.notes}
          q={loaderData.q}
          lang={loaderData.lang}
          langs={loaderData.langs}
          audits={loaderData.audits}
        />
      </section>

      <div id="lp-vocab-anki"><Details summary={t("anki.title")}>
        <AnkiImport langs={loaderData.langs} />
        <AnkiExport />
      </Details></div>
    </div>
  );
}
