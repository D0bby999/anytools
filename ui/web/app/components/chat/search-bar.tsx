/**
 * search-bar.tsx — the bar that finds text in a conversation (after
 * postclaw's search bar). Presentational: the hook (use-chat-search.ts) holds
 * the state. Enter and Shift+Enter step through matches, Escape closes it
 * (and never stops a running answer), and the count is announced politely.
 */
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatSearchController } from "~/hooks/use-chat-search";
import { cn } from "~/lib/utils";

const TOOL =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function SearchBar({ search, className }: { search: ChatSearchController; className?: string }) {
  const { t } = useTranslation("common");
  if (!search.open) return null;
  const hasQuery = search.query.trim() !== "";
  const none = hasQuery && search.count === 0;

  return (
    <div
      role="search"
      data-testid="chat-search-bar"
      className={cn("flex items-center gap-1 rounded-lg border bg-card px-2 py-1 shadow-sm", className)}
    >
      <input
        ref={search.inputRef}
        type="text"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) search.prev();
            else search.next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            search.close();
          }
        }}
        aria-label={t("chat.find.label")}
        placeholder={t("chat.find.placeholder")}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-base leading-6 outline-none placeholder:text-muted-foreground"
      />
      <span aria-live="polite" aria-atomic="true" className="shrink-0 px-1 text-sm text-muted-foreground tabular-nums">
        {none ? t("chat.find.none") : hasQuery ? t("chat.find.count", { current: search.position, total: search.count }) : null}
      </span>
      <button type="button" onClick={search.prev} disabled={search.count === 0} aria-label={t("chat.find.previous")} title={t("chat.find.previous")} className={TOOL}>
        <ChevronUp aria-hidden="true" className="size-4" />
      </button>
      <button type="button" onClick={search.next} disabled={search.count === 0} aria-label={t("chat.find.next")} title={t("chat.find.next")} className={TOOL}>
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      <button type="button" onClick={search.close} aria-label={t("chat.find.close")} title={t("chat.find.close")} className={TOOL}>
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
