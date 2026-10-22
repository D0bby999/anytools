/**
 * "Save mistakes to review" under a chat answer (the private design notes, phase 3). The first press asks the learner's chat model once for
 * the mistakes this answer corrected in the message before it; the list
 * comes back with a box per mistake (what was written → what is right, and
 * why), all ticked. Saving keeps the ticked ones as words to learn, due
 * today, with an optional card for saying it right. Nothing spins: the
 * button says what it is doing.
 */
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { ChatCorrection, CorrectionsData } from "~/routes/app.api.chat-corrections";

const ACTION = "/app/api/chat-corrections";

const fetcherKey = (messageId: string) => `chat-mistakes-${messageId}`;

/** The text action in the answer's row: finds the mistakes, once. */
export function SaveMistakesButton({ messageId, className }: { messageId: string; className?: string }) {
  const { t } = useTranslation("common");
  const finder = useFetcher<CorrectionsData>({ key: fetcherKey(messageId) });
  if (finder.data?.ok) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={finder.state !== "idle"}
      onClick={() => void finder.submit({ intent: "find", messageId }, { method: "post", action: ACTION })}
    >
      {finder.state !== "idle" ? t("chat.mistakes.finding") : t("chat.mistakes.open")}
    </button>
  );
}

/** Under the row: the list to tick, and what was saved. */
export function SaveMistakesPanel({ messageId }: { messageId: string }) {
  const { t } = useTranslation("common");
  const finder = useFetcher<CorrectionsData>({ key: fetcherKey(messageId) });
  const saver = useFetcher<CorrectionsData>();
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [production, setProduction] = useState(false);

  const found = finder.data?.ok && finder.data.intent === "find" ? finder.data : null;
  const saved = saver.data?.ok && saver.data.intent === "save" ? saver.data : null;
  const failure = saver.data && !saver.data.ok ? saver.data : finder.data && !finder.data.ok ? finder.data : null;

  if (!found) {
    return failure ? (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {failure.error || t("chat.mistakes.failed")}
      </p>
    ) : null;
  }
  if (found.corrections.length === 0) {
    return (
      <p role="status" className="mt-1 text-sm text-muted-foreground">
        {t("chat.mistakes.none")}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="mt-1 text-sm">
        {t("chat.mistakes.saved", { count: saved.created })}{" "}
        <Link to="/mastery/vocabulary" className="text-primary underline underline-offset-4">
          {t("chat.mistakes.review")}
        </Link>
      </p>
    );
  }

  const chosen: ChatCorrection[] = found.corrections.filter((_, i) => !skipped.has(i));
  const toggle = (i: number) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section aria-label={t("chat.mistakes.title")} className="mt-2 rounded-md border bg-card p-3 text-sm">
      <p className="text-xs text-muted-foreground">{t("chat.mistakes.lead")}</p>
      <ul className="mt-2 grid list-none gap-2 p-0">
        {found.corrections.map((c, i) => (
          <li key={`${c.wrong}-${c.right}`}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={!skipped.has(i)} onChange={() => toggle(i)} />
              <span>
                <span lang={found.lang || undefined}>
                  <s className="text-muted-foreground">{c.wrong}</s> → <strong>{c.right}</strong>
                </span>
                {c.why ? <span className="block text-xs leading-snug text-muted-foreground">{c.why}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="mt-0.5" checked={production} onChange={(e) => setProduction(e.target.checked)} />
        <span>{t("chat.mistakes.production")}</span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={chosen.length === 0 || saver.state !== "idle"}
          onClick={() =>
            void saver.submit(
              { intent: "save", messageId, lang: found.lang, items: JSON.stringify(chosen.map((c) => ({ ...c, production }))) },
              { method: "post", action: ACTION },
            )
          }
        >
          {saver.state !== "idle" ? t("chat.mistakes.saving") : t("chat.mistakes.save", { count: chosen.length })}
        </Button>
        {failure ? (
          <span role="alert" className="text-xs text-destructive">
            {failure.error || t("chat.mistakes.failed")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
