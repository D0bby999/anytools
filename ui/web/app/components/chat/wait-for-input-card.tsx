import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { PendingQuestion } from "~/hooks/use-turn-stream";

/**
 * The ask_user card.
 *
 * Options are suggestions, never a closed set: the free-text field is always
 * present and always usable. A model that offers three buttons has guessed at
 * the axis of ambiguity, and forcing the user onto that axis is how a
 * clarification becomes an obstacle.
 *
 * The card is a form so Enter submits the typed answer, and the question is the
 * field's label rather than a paragraph above it — a label a screen reader
 * announces with the input, instead of text it has to hunt for.
 */
export function WaitForInputCard({
  question,
  onAnswer,
  pending,
}: {
  question: PendingQuestion;
  onAnswer: (answer: string) => void;
  pending?: boolean;
}) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState("");

  return (
    <form
      // role=group + the live region means the card announces itself when it
      // appears mid-stream, rather than silently becoming the thing the whole
      // turn is waiting on.
      role="group"
      aria-live="polite"
      onSubmit={(e) => {
        e.preventDefault();
        const answer = value.trim();
        if (answer) onAnswer(answer);
      }}
      className="max-w-(--lp-measure-read) rounded-(--lp-radius-card) border border-control-border bg-card p-4"
    >
      <p className="lp-kicker">{t("chat.question.title")}</p>

      <label htmlFor="lp-ask-user" className="mt-2 block font-serif text-base leading-prose">
        {question.question}
      </label>

      {question.options.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {question.options.map((option) => (
            <li key={option}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onAnswer(option)}
              >
                {option}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          id="lp-ask-user"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("chat.question.placeholder")}
          className={
            "h-10 flex-1 rounded-md border border-control-border bg-background px-3 text-sm " +
            "text-foreground placeholder:text-faint focus-visible:outline-none " +
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 " +
            "focus-visible:ring-offset-background disabled:opacity-50"
          }
        />
        <Button type="submit" size="sm" disabled={pending || value.trim() === ""}>
          {t("chat.question.submit")}
        </Button>
      </div>
    </form>
  );
}
