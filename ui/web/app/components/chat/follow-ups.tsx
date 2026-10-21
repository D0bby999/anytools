import { useTranslation } from "react-i18next";
import type { FollowUp } from "~/lib/chat-work";

/**
 * Next steps under the last answer, or starters in an empty conversation.
 *
 * The server picks the kinds from what the turn did (suggestions.go) and never
 * writes their words; the words live here, and clicking one sends them as the
 * learner's next message. Since the up shell they are a list of links in the
 * action ink, each led by "→", as up ends a chapter with its next steps; they
 * stay buttons underneath, because they send a message rather than go
 * anywhere. The arrow is hidden from the accessible name.
 */
export function FollowUps({
  kinds,
  onPick,
  disabled,
}: {
  kinds: FollowUp[];
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  if (kinds.length === 0) return null;
  return (
    <PromptRow
      label={t("chat.followUps.label")}
      prompts={kinds.map((k) => ({ label: t(`chat.followUps.${k}.label`), prompt: t(`chat.followUps.${k}.prompt`) }))}
      onPick={onPick}
      disabled={disabled}
    />
  );
}

/** Ways to begin, named after what the conversation reads. */
export function Starters({
  kbNames,
  onPick,
  disabled,
}: {
  kbNames: string[];
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("common");
  if (kbNames.length === 0) return null;
  const name = kbNames.length === 1 ? kbNames[0] : t("chat.starters.these");
  const prompts = (["overview", "keyIdeas", "quiz"] as const).map((k) => {
    const text = t(`chat.starters.${k}`, { name });
    return { label: text, prompt: text };
  });
  return <PromptRow label={t("chat.starters.label")} prompts={prompts} onPick={onPick} disabled={disabled} />;
}

function PromptRow({
  label,
  prompts,
  onPick,
  disabled,
}: {
  label: string;
  prompts: { label: string; prompt: string }[];
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4" role="group" aria-label={label}>
      <ul className="flex flex-col gap-1">
        {prompts.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(p.prompt)}
              className="inline-flex min-h-8 items-baseline gap-2 rounded-[4px] text-left text-base leading-[1.6] font-medium text-primary transition-colors hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              <span aria-hidden="true">→</span>
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
