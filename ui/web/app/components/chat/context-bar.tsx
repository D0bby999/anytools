import { useTranslation } from "react-i18next";

/**
 * The sticky context bar: what this conversation can read, and whether it may
 * reach the web.
 *
 * It is always visible rather than tucked into a menu, because "which documents
 * is it answering from" is the question a user has every single time they read
 * an answer. A context that has to be opened to be seen is a context nobody
 * checks.
 *
 * The "allow web in this session" toggle is HIDDEN until phase 9 ships a
 * network tool. A switch that controls nothing teaches people that switches
 * here do not matter.
 */
export function ContextBar({
  title,
  kbCount,
  allowWeb,
  onToggleWeb,
  showWebToggle = false,
}: {
  title: string;
  kbCount: number;
  allowWeb: boolean;
  onToggleWeb?: (next: boolean) => void;
  showWebToggle?: boolean;
}) {
  const { t } = useTranslation("common");

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted px-4 py-2">
      <h1 className="min-w-0 flex-1 truncate font-serif text-lg">{title || t("chat.untitled")}</h1>

      <p className="text-xs leading-ui text-muted-foreground">
        {kbCount === 0
          ? t("chat.context.none")
          : t("chat.context.count", { count: kbCount })}
      </p>

      {showWebToggle && onToggleWeb && (
        <label className="flex items-center gap-2 text-xs leading-ui">
          <input
            type="checkbox"
            checked={allowWeb}
            onChange={(e) => onToggleWeb(e.target.checked)}
            className="size-4 accent-primary"
          />
          {t("chat.context.allowWeb")}
        </label>
      )}
    </div>
  );
}
