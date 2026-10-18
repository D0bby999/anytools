import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { OwnVersionShown } from "~/components/chat/own-version-fields";
import { MAX_RETELL, type OwnVersion, type Retell } from "~/lib/own-version";
import type { RetellActionData } from "~/routes/app.api.retell";

/**
 * "Close it and retell" (up-methods phase 11; up's screen-off test, attention
 * chapter §3), around an answer whose question carried the learner's own
 * version.
 *
 * While the learner writes, the answer is not rendered at all — collapsed, not
 * covered — so the retell is written without it. Once saved, the answer comes
 * back and the retell sits beside the three lines written before asking, for
 * comparison. Saving again replaces the retell.
 */
export function RetellBox({
  messageId,
  ownVersion,
  saved,
  children,
}: {
  messageId: string;
  ownVersion: OwnVersion;
  saved?: Retell;
  /** The answer. */
  children: ReactNode;
}) {
  const { t } = useTranslation("ownversion");
  const fetcher = useFetcher<RetellActionData>();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [retell, setRetell] = useState<Retell | undefined>(saved);
  const pending = fetcher.state !== "idle";
  const id = `lp-retell-${messageId}`;

  // A reloaded transcript is the source of truth once it has the retell.
  useEffect(() => {
    if (saved) setRetell(saved);
  }, [saved]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setRetell(fetcher.data.retell);
      setWriting(false);
      setText("");
    }
  }, [fetcher.state, fetcher.data]);

  if (writing) {
    return (
      <div>
        <p role="status" className="rounded-(--lp-radius-control) bg-sunken px-3 py-2 text-sm leading-prose text-muted-foreground">
          {t("retell.hidden")}
        </p>
        <fetcher.Form method="post" action="/app/api/retell" className="mt-3 space-y-2">
          <input type="hidden" name="messageId" value={messageId} />
          <label htmlFor={id} className="block text-sm font-medium">
            {t("retell.label")}
          </label>
          <p id={`${id}-hint`} className="text-xs leading-snug text-muted-foreground">
            {t("retell.hint")}
          </p>
          <textarea
            id={id}
            name="text"
            rows={6}
            required
            maxLength={MAX_RETELL}
            aria-describedby={`${id}-hint`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={
              "w-full resize-y rounded-md border border-control-border bg-card px-3 py-2 " +
              "text-sm leading-prose text-foreground " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
              "focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || text.trim() === ""}>
              {pending ? t("retell.saving") : t("retell.save")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setWriting(false)}>
              {t("retell.cancel")}
            </Button>
          </div>
          {fetcher.data && !fetcher.data.ok ? (
            <p role="alert" className="text-sm leading-snug text-destructive">
              {t("retell.failed")} {fetcher.data.error}
            </p>
          ) : null}
        </fetcher.Form>
      </div>
    );
  }

  return (
    <div>
      {children}
      {retell ? (
        <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2">
          <OwnVersionShown value={ownVersion} />
          <div>
            <p className="lp-kicker">{t("retell.title")}</p>
            <p className="mt-1 text-sm leading-prose whitespace-pre-wrap">{retell.text}</p>
          </div>
        </div>
      ) : null}
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setWriting(true)}>
          {retell ? t("retell.again") : t("retell.open")}
        </Button>
      </div>
    </div>
  );
}
