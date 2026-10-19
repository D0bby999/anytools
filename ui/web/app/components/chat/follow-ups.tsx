import { useTranslation } from "react-i18next";
import type { FollowUp } from "~/lib/chat-work";

/**
 * Next steps under the last answer, or starters in an empty conversation.
 *
 * The server picks the kinds from what the turn did (suggestions.go) and never
 * writes their words; the words live here, and clicking one sends them as the
 * learner's next message. They are outlined buttons in a row, the same weight
 * as any secondary action, so they read as offers rather than as part of the
 * answer.
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
    <div className="mt-3" role="group" aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(p.prompt)}
              className="min-h-9 rounded-full border border-control-border bg-card px-3 text-left text-sm leading-ui text-foreground hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
