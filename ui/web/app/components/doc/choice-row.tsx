import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/doc/badge";

export type Choice = {
  id: string;
  label: ReactNode;
  /** After marking: the right answer, or the learner's wrong one. */
  state?: "correct" | "wrong";
};

/**
 * Rows to choose from (I1), drawn like VPLocalSearchBox's results: a 2px
 * hairline box that turns to the action ink on hover and when chosen. After
 * marking, the right row keeps the action ink with a "Correct" badge and a
 * wrong pick turns red with an "Incorrect" badge, so the result is never in
 * colour alone.
 *
 * A radio group (an answer) or a listbox (a pick from a list). One tab stop;
 * ↑↓ (and ←→) move and choose, Home and End jump, and the digit keys 1–9
 * choose that row, as a quiz on paper is answered by number.
 */
export function ChoiceRow({
  choices,
  value,
  onChange,
  label,
  role = "radiogroup",
  disabled = false,
}: {
  choices: Choice[];
  value: string | null;
  onChange: (id: string) => void;
  label: string;
  role?: "radiogroup" | "listbox";
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const current = Math.max(
    0,
    choices.findIndex((c) => c.id === value),
  );
  const itemRole = role === "radiogroup" ? "radio" : "option";
  const stateAttr = role === "radiogroup" ? "aria-checked" : "aria-selected";

  const choose = (index: number) => {
    const choice = choices[index];
    if (!choice || disabled) return;
    onChange(choice.id);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = choices.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (/^[1-9]$/.test(event.key) && Number(event.key) <= choices.length) next = Number(event.key) - 1;
    else if (event.key === " " || event.key === "Enter") next = index;
    if (next === null) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <ul className="lp-choice-group" role={role} aria-label={label} aria-disabled={disabled || undefined}>
      {choices.map((choice, i) => {
        const chosen = choice.id === value;
        return (
          <li
            key={choice.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role={itemRole}
            {...{ [stateAttr]: chosen }}
            aria-disabled={disabled || undefined}
            tabIndex={i === current ? 0 : -1}
            className="lp-choice"
            data-state={choice.state}
            onClick={() => choose(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="lp-choice-body">{choice.label}</span>
            {choice.state === "correct" ? <Badge type="tip">{t("doc.correct")}</Badge> : null}
            {choice.state === "wrong" ? <Badge type="danger">{t("doc.incorrect")}</Badge> : null}
          </li>
        );
      })}
    </ul>
  );
}
