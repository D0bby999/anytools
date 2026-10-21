import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { clozeMatches, RATINGS, suggestedRating, type DueCard, type Rating } from "~/lib/vocab-types";
import { Button } from "~/components/ui/button";
import { ClipPlayer } from "~/components/vocab/clip-player";
import { WritingPad, writingRating, type Written } from "~/components/vocab/writing-pad";
import { Lookups } from "~/components/languages/lookups";
import { CardPicture, PictureCredit } from "~/components/vocab/card-picture";
import { readingKind } from "~/lib/languages";

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
 * - Listen (only when asked for; the private design notes, phase 1):
 *   the transcript line the word was saved from is played, and the learner
 *   types the word heard; marked like a cloze. The line, blanked, is behind
 *   "Show the line". A card whose video is gone shows the blanked line, and
 *   says so.
 *
 * Each card's review carries a request id kept until the server confirms it,
 * so a retry after a dropped response cannot schedule the card twice.
 */
export function ReviewSession({ cards, total }: { cards: DueCard[]; total: number }) {
  const { t } = useTranslation("vocab");
  const fetcher = useFetcher<ReviewData>();
  // The cards reviewed in this session, by id. Not a position: a review
  // reloads the page's due cards without the one just reviewed, so the
  // position of the next card changes under the session.
  const [done, setDone] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [lineShown, setLineShown] = useState(false);
  const [written, setWritten] = useState<Written | null>(null);
  const requestIDs = useRef(new Map<string, string>());
  const queue = cards.filter((c) => !done.includes(c.id));
  const card = queue[0];
  // A new card starts unanswered (set while rendering, so it never shows the
  // last card's answer for a frame).
  const [shownId, setShownId] = useState(card?.id);
  if (card?.id !== shownId) {
    setShownId(card?.id);
    setRevealed(false);
    setAnswer("");
    setLineShown(false);
    setWritten(null);
  }

  const requestID = useMemo(() => {
    if (!card) return "";
    const known = requestIDs.current.get(card.id);
    if (known) return known;
    const id = newRequestID();
    requestIDs.current.set(card.id, id);
    return id;
  }, [card]);

  // Advance once the server confirms a card's review.
  const reviewed = fetcher.state === "idle" ? fetcher.data?.reviewed : undefined;
  useEffect(() => {
    if (reviewed) setDone((d) => (d.includes(reviewed) ? d : [...d, reviewed]));
  }, [reviewed]);

  // The control a keyboard was on goes away twice per card: "Show" when the
  // answer is shown, the ratings when the next card comes. When focus fell to
  // the page there, it goes to the ratings (the suggested one first), or to
  // the new card, so Tab carries on from where the learner was.
  const region = useRef<HTMLElement | null>(null);
  const ratings = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    // A control just disabled (the typed answer once checked) still holds
    // focus until the browser moves it; that counts as lost too.
    const el = document.activeElement;
    const lost = !el || el === document.body || el.matches(":disabled");
    if (!lost) return;
    if (revealed && ratings.current) {
      const buttons = [...ratings.current.querySelectorAll<HTMLButtonElement>("button")];
      (buttons.find((b) => b.dataset.suggested !== undefined) ?? buttons[0])?.focus();
    } else if (done.length > 0) {
      region.current?.focus();
    }
  }, [done.length, revealed, shownId]);

  if (cards.length === 0 && done.length === 0) {
    return (
      <p ref={(el) => void (region.current = el)} tabIndex={-1} className="mt-3 lp-empty focus:outline-none">
        {t("session.empty")}
      </p>
    );
  }
  if (!card) {
    return (
      <p ref={(el) => void (region.current = el)} tabIndex={-1} role="status" className="mt-3 text-sm leading-prose text-muted-foreground focus:outline-none">
        {total > cards.length ? t("session.more", { count: total - cards.length }) : t("session.finished")}
      </p>
    );
  }

  const busy = fetcher.state !== "idle";
  // The cards answered by typing the term.
  const typed = card.kind === "cloze" || card.kind === "production" || card.kind === "listen";
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
  const suggested =
    card.kind === "write" ? (written ? writingRating(written) : null) : typed && revealed ? suggestedRating(answer, card.term) : null;
  const matched = typed && revealed ? clozeMatches(answer, card.term) : null;

  return (
    <div ref={(el) => void (region.current = el)} tabIndex={-1} className="mt-3 border-t pt-4 focus:outline-none">
      <p className="text-xs font-semibold text-muted-foreground">
        {t("session.progress", { done: done.length + 1, total: done.length + queue.length })} · {card.kind === "production" ? t("production.kind") : card.kind === "listen" ? t("listen.kind") : card.kind === "write" ? t("write.kind") : card.kind === "card" ? (card.deck?.name ?? "") : card.kind}
        {card.lang ? ` · ${card.lang}` : ""}
      </p>

      {card.kind === "flash" || card.kind === "card" ? (
        <>
          {card.image ? <CardPicture image={card.image} /> : null}
          <p className="mt-3 font-serif text-xl font-semibold leading-snug" dir="auto">
            {card.front}
          </p>
          {!revealed ? (
            <Button type="button" className="mt-3" onClick={() => setRevealed(true)}>
              {t("session.revealBack")}
            </Button>
          ) : null}
        </>
      ) : card.kind === "write" ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">{t("write.prompt")}</p>
          <p className="mt-2 text-base leading-prose">
            {card.meaning}
            {card.reading ? (
              <span className="ml-3 text-sm text-muted-foreground" lang={card.lang}>
                {t(`reading.${readingKind(card.lang)}`)}: {card.reading}
              </span>
            ) : null}
          </p>
          {card.cloze ? (
            <blockquote className="rounded-lg border bg-sunken p-4 mt-2 text-sm leading-prose text-muted-foreground" lang={card.lang}>
              {card.cloze}
            </blockquote>
          ) : null}
          <WritingPad
            key={card.id}
            term={card.term}
            lang={card.lang}
            onDone={(w) => {
              setWritten(w);
              setRevealed(true);
            }}
          />
        </>
      ) : card.kind === "recognition" ? (
        <>
          <p className="mt-3 font-sans text-2xl font-semibold" lang={card.lang}>
            {card.term}
            {card.reading ? (
              <span className="ml-3 font-sans text-sm font-normal text-muted-foreground">
                <span className="sr-only">{t(`reading.${readingKind(card.lang)}`)}: </span>
                {card.reading}
              </span>
            ) : null}
          </p>
          {card.context ? (
            <blockquote className="rounded-lg border bg-sunken p-4 mt-3 text-sm leading-prose" lang={card.lang}>
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
          ) : card.kind === "listen" ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">{t("listen.prompt")}</p>
              {card.clip ? <ClipPlayer key={card.id} clip={card.clip} /> : <p className="mt-3 text-sm">{t("listen.gone")}</p>}
              {lineShown || !card.clip || revealed ? (
                <blockquote className="rounded-lg border bg-sunken p-4 mt-3 text-base leading-prose" lang={card.lang}>
                  {card.cloze}
                </blockquote>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setLineShown(true)}>
                  {t("listen.showLine")}
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">{t("session.clozePrompt")}</p>
              <blockquote className="rounded-lg border bg-sunken p-4 mt-3 text-base leading-prose" lang={card.lang}>
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
                className="min-h-11 w-64 max-w-full rounded-md border border-control-border bg-card px-3 text-base text-foreground"
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
          {card.kind === "flash" || card.kind === "card" ? (
            <>
              <p className="mt-2 whitespace-pre-line text-base leading-prose" dir="auto">
                {card.back}
              </p>
              {card.image ? <PictureCredit image={card.image} /> : null}
            </>
          ) : card.kind === "production" ? (
            <div className="mt-2 text-base leading-prose">
              <p>
                {card.reading ? (
                  <span className="mr-2 text-sm text-muted-foreground">
                    <span className="sr-only">{t(`reading.${readingKind(card.lang)}`)}: </span>
                    {card.reading}
                  </span>
                ) : null}
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
                <blockquote className="rounded-lg border bg-sunken p-4 mt-2 text-sm leading-prose text-muted-foreground" lang={card.lang}>
                  {card.context}
                </blockquote>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-base leading-prose">
              <p>
                {card.pos ? <span className="mr-2 font-mono text-2xs text-muted-foreground">{card.pos}</span> : null}
                {card.meaning}
              </p>
              {card.kind === "listen" && card.context ? (
                <blockquote className="rounded-lg border bg-sunken p-4 mt-2 text-sm leading-prose text-muted-foreground" lang={card.lang}>
                  {card.context}
                </blockquote>
              ) : null}
            </div>
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
          {card.kind !== "flash" ? <Lookups lang={card.lang} term={card.term} className="mt-1" /> : null}

          <fieldset ref={ratings} className="mt-4" disabled={busy}>
            <legend className="text-xs text-muted-foreground">{card.kind === "flash" || card.kind === "card" ? t("session.rateLabelCard") : t("session.rateLabel")}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {RATINGS.map((rating) => (
                <Button
                  key={rating}
                  type="button"
                  variant="outline"
                  data-suggested={suggested === rating ? "" : undefined}
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
