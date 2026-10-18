import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { clozeMatches, RATINGS, suggestedRating, type DueCard, type Rating } from "~/lib/vocab-types";
import { Button } from "~/components/ui/button";

type ReviewData = { reviewed?: string; errorKey?: string };

/**
 * A fresh idempotency key; a card keeps its key until the review is saved.
 * randomUUID exists only in secure contexts, so an AnyTools opened over plain
 * http on a home network builds the v4 uuid from getRandomValues instead.
 */
export function newRequestID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Today's cards, one at a time, oldest first.
 *
 * - Recognition: the term and the sentence it was met in; reveal the meaning,
 *   then rate Again / Hard / Good / Easy.
 * - Cloze: the sentence with a blank; type the term. An exact or accent-
 *   insensitive match suggests Good, anything else Again, and the learner
 *   confirms with the rating they choose.
 * - Flash (a living book's card, in the Book cards queue): the front; reveal
 *   the back, then rate. Same schedule, same review route.
 * - Production (only when the learner asked for it, up-methods phase 3): the
 *   learner's own situation and the meaning, with a blank to type the
 *   expression; marked like a cloze. The back adds the reading, the part of
 *   speech, the confusable expression and the sentence it was met in.
 *
 * Each card's review carries a request id kept until the server confirms it,
 * so a retry after a dropped response cannot schedule the card twice.
 */
export function ReviewSession({ cards, total }: { cards: DueCard[]; total: number }) {
  const { t } = useTranslation("vocab");
  const fetcher = useFetcher<ReviewData>();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const requestIDs = useRef(new Map<string, string>());
  const card = cards[index];

  const requestID = useMemo(() => {
    if (!card) return "";
    const known = requestIDs.current.get(card.id);
    if (known) return known;
    const id = newRequestID();
    requestIDs.current.set(card.id, id);
    return id;
  }, [card]);

  // Advance once the server confirms THIS card's review.
  useEffect(() => {
    if (fetcher.state === "idle" && card && fetcher.data?.reviewed === card.id) {
      setIndex((i) => i + 1);
      setRevealed(false);
      setAnswer("");
    }
  }, [fetcher.state, fetcher.data, card]);

  if (cards.length === 0) {
    return <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("session.empty")}</p>;
  }
  if (!card) {
    return (
      <p role="status" className="mt-3 text-sm leading-prose text-muted-foreground">
        {total > cards.length ? t("session.more", { count: total - cards.length }) : t("session.finished")}
      </p>
    );
  }

  const busy = fetcher.state !== "idle";
  // The cards answered by typing the term.
  const typed = card.kind === "cloze" || card.kind === "production";
  const labels: Record<Rating, string> = {
    again: t("session.again"),
    hard: t("session.hard"),
    good: t("session.good"),
    easy: t("session.easy"),
  };
  const rate = (rating: Rating) =>
    fetcher.submit(
      { intent: "review", card_id: card.id, rating, answer: typed ? answer : "", request_id: requestID },
      { method: "post" },
    );
  const suggested = typed && revealed ? suggestedRating(answer, card.term) : null;
  const matched = typed && revealed ? clozeMatches(answer, card.term) : null;

  return (
    <div className="mt-3 border-t pt-4" aria-live="polite">
      <p className="font-mono text-2xs uppercase tracking-wide text-muted-foreground">
        {t("session.progress", { done: index + 1, total: cards.length })} · {card.kind === "production" ? t("production.kind") : card.kind}
        {card.lang ? ` · ${card.lang}` : ""}
      </p>

      {card.kind === "flash" ? (
        <>
          <p className="mt-3 font-serif text-xl font-semibold leading-snug">{card.front}</p>
          {!revealed ? (
            <Button type="button" className="mt-3" onClick={() => setRevealed(true)}>
              {t("session.revealBack")}
            </Button>
          ) : null}
        </>
      ) : card.kind === "recognition" ? (
        <>
          <p className="mt-3 font-serif text-2xl font-semibold" lang={card.lang}>
            {card.term}
            {card.reading ? <span className="ml-3 font-sans text-sm font-normal text-muted-foreground">{card.reading}</span> : null}
          </p>
          {card.context ? (
            <blockquote className="mt-3 text-sm leading-prose" lang={card.lang}>
              {card.context}
            </blockquote>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">{t("session.recognitionPrompt")}</p>
          {!revealed ? (
            <Button type="button" className="mt-3" onClick={() => setRevealed(true)}>
              {t("session.reveal")}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {card.kind === "production" ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">{t("production.prompt")}</p>
              <dl className="mt-3 grid gap-2 text-base leading-prose">
                <div>
                  <dt className="lp-kicker">{t("production.scenario")}</dt>
                  <dd>{card.scenario}</dd>
                </div>
                <div>
                  <dt className="lp-kicker">{t("production.sense")}</dt>
                  <dd>{card.meaning}</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">{t("session.clozePrompt")}</p>
              <blockquote className="mt-3 text-base leading-prose" lang={card.lang}>
                {card.cloze}
              </blockquote>
            </>
          )}
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setRevealed(true);
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("session.answerLabel")}
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={revealed}
                lang={card.lang}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                maxLength={200}
                className="min-h-11 w-64 max-w-full rounded-md border border-control-border bg-background px-3 text-base text-foreground"
              />
            </label>
            {!revealed ? <Button type="submit">{t("session.check")}</Button> : null}
          </form>
        </>
      )}

      {revealed ? (
        <div className="mt-4">
          {matched !== null ? (
            <p role="status" className="text-sm">
              {matched ? t("session.matched") : t("session.notMatched")}{" "}
              <strong lang={card.lang}>{card.term}</strong>
            </p>
          ) : null}
          {card.kind === "flash" ? (
            <p className="mt-2 text-base leading-prose">{card.back}</p>
          ) : card.kind === "production" ? (
            <div className="mt-2 text-base leading-prose">
              <p>
                {card.reading ? <span className="mr-2 text-sm text-muted-foreground">{card.reading}</span> : null}
                {card.pos ? <span className="mr-2 font-mono text-2xs text-muted-foreground">{card.pos}</span> : null}
                {card.meaning}
              </p>
              {card.confusable ? (
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">{t("production.confusable")}: </span>
                  {card.confusable}
                </p>
              ) : null}
              {card.context ? (
                <blockquote className="mt-2 text-sm leading-prose text-muted-foreground" lang={card.lang}>
                  {card.context}
                </blockquote>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-base leading-prose">
              {card.pos ? <span className="mr-2 font-mono text-2xs text-muted-foreground">{card.pos}</span> : null}
              {card.meaning}
            </p>
          )}
          {card.book ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <Link
                to={`/books/${card.book.book_id}/chapters/${card.book.chapter_id}`}
                className="text-primary underline underline-offset-4"
              >
                {t("session.from", { title: card.book.title })}
              </Link>
            </p>
          ) : null}
          {card.source ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <Link
                to={`/documents/${card.source.document_id}${card.source.page ? `?page=${card.source.page}` : ""}`}
                className="text-primary underline underline-offset-4"
              >
                {t("session.from", { title: card.source.title })}
              </Link>
            </p>
          ) : null}

          <fieldset className="mt-4" disabled={busy}>
            <legend className="text-xs text-muted-foreground">{t("session.rateLabel")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {RATINGS.map((rating) => (
                <Button
                  key={rating}
                  type="button"
                  variant={suggested === rating ? "default" : "outline"}
                  onClick={() => rate(rating)}
                >
                  {labels[rating]}
                  {suggested === rating ? <span className="sr-only"> ({t("session.suggested")})</span> : null}
                </Button>
              ))}
            </div>
          </fieldset>
          {fetcher.data?.errorKey && fetcher.data.reviewed !== card.id ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t("session.failed")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
