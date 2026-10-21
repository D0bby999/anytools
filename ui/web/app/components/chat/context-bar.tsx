import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";

export type ContextKB = { id: string; name: string };

/**
 * The sticky context bar: what this conversation can read, and whether it may
 * reach the web.
 *
 * It is always visible rather than tucked into a menu, because "which documents
 * is it answering from" is the question a user has every single time they read
 * an answer. A context that has to be opened to be seen is a context nobody
 * checks. The names are on the bar; only changing them opens a panel.
 *
 * The "allow web in this session" toggle is HIDDEN until phase 9 ships a
 * network tool. A switch that controls nothing teaches people that switches
 * here do not matter.
 */
export function ContextBar({
  title,
  kbs,
  attached,
  allowWeb,
  onToggleWeb,
  showWebToggle = false,
}: {
  title: string;
  /** Every knowledge base the learner has, to choose from. */
  kbs: ContextKB[];
  /** The ids this conversation reads. */
  attached: string[];
  allowWeb: boolean;
  onToggleWeb?: (next: boolean) => void;
  showWebToggle?: boolean;
}) {
  const { t } = useTranslation("common");
  const names = kbs.filter((k) => attached.includes(k.id)).map((k) => k.name);
  const none = names.length === 0;

  return (
    // The conversation opens as a chapter does: its title as the h1, then a
    // book-meta line (I5) saying what it reads, which is also the control
    // that changes it.
    <div className="mb-8">
      <h1 id="page-title" className="lp-h1 text-[2rem]! break-words">
        {title || t("chat.untitled")}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">

      <details className="group relative">
        <summary
          className={`flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden ${
            none ? "bg-warning-soft px-2 text-foreground" : "text-muted-foreground"
          }`}
          aria-label={t("chat.context.choose")}
        >
          <BookOpen className="size-3.5" aria-hidden="true" />
          {none ? (
            t("chat.context.chooseNone")
          ) : (
            <span className="max-w-72 truncate">
              <span className="text-muted-foreground">{t("chat.context.readingFrom")}: </span>
              {names.join(", ")}
            </span>
          )}
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="absolute left-0 z-dropdown mt-2 w-72 rounded-xl border bg-card p-3 shadow-md">
          {kbs.length === 0 ? (
            <p className="text-sm leading-prose text-muted-foreground">{t("chat.context.noKnowledge")}</p>
          ) : (
            <Form
              method="post"
              className="flex flex-col gap-3"
              onSubmit={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
            >
              <input type="hidden" name="intent" value="kbs" />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-xs leading-ui text-muted-foreground">{t("chat.context.chooseHelp")}</legend>
                {kbs.map((kb) => (
                  <label key={kb.id} className="flex min-h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="kb_id"
                      value={kb.id}
                      defaultChecked={attached.includes(kb.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="truncate">{kb.name}</span>
                  </label>
                ))}
              </fieldset>
              <Button type="submit" size="sm" className="self-start">
                {t("chat.context.apply")}
              </Button>
            </Form>
          )}
        </div>
      </details>

      {showWebToggle && onToggleWeb && (
        <label className="flex items-center gap-2 text-sm">
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
    </div>
  );
}
