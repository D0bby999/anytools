import { useId } from "react";
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { Flyout } from "~/components/doc/flyout";

/**
 * The chat list's quick-start (I3): up's `.quick-start`, drawn with the
 * library's classes, because its one action is a POST (a conversation is
 * created, then opened) and the library's QuickStart only takes links.
 *
 * "Reads" is a flyout (I9) of the learner's knowledge bases as checkboxes
 * inside the same form. None ticked sends no kb_id, and the action then gives
 * the conversation all of them, as the plain "New conversation" always did.
 */
export function NewConversation({ kbs, busy }: { kbs: { id: string; name: string }[]; busy: boolean }) {
  const { t } = useTranslation("common");
  const id = `lp-chat-qs-${useId().replace(/:/g, "")}`;
  return (
    <section className="lp-quick-start" aria-labelledby={id}>
      <div className="lp-quick-start-heading">
        <span className="lp-kicker">{t("chat.index.kicker")}</span>
        <h2 id={id}>{t("chat.index.startTitle")}</h2>
        <p>{t("chat.index.startBody")}</p>
      </div>
      <Form method="post" className="lp-quick-start-actions">
        <button type="submit" disabled={busy} className="lp-quick-start-action lp-quick-start-action-primary disabled:opacity-60">
          {t("chat.new")}
        </button>
        {kbs.length > 0 ? (
          <Flyout
            label={t("chat.index.reads")}
            buttonClassName="h-10 rounded-sm"
            menuClassName="top-11 left-0 right-auto min-w-56"
          >
            <fieldset>
              <legend className="px-3 text-sm leading-8 font-semibold">{t("chat.index.readsLegend")}</legend>
              {kbs.map((kb) => (
                <label
                  key={kb.id}
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm font-medium hover:bg-hover"
                >
                  <input type="checkbox" name="kb_id" value={kb.id} className="size-4 accent-primary" />
                  <span className="min-w-0 truncate">{kb.name}</span>
                </label>
              ))}
              <p className="px-3 pt-1 text-xs leading-5 text-muted-foreground">{t("chat.index.readsHint")}</p>
            </fieldset>
          </Flyout>
        ) : null}
      </Form>
    </section>
  );
}
