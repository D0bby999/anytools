/**
 * calendar-card.tsx
 * Learning apps → Study calendar (learning-tool-connections phase 2): the
 * feed URL, one button that adds it to Google Calendar, a copy for Apple
 * Calendar and Outlook, what the calendar shows, and Change the URL.
 *
 * Generic titles are the default (red team #2): a feed URL is a credential
 * that can leak, and with names off it says nothing about the learner.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { CalendarPlus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { CopyText } from "~/components/ui/copy-text";
import { DateText } from "~/components/ui/date-text";
import { Dialog } from "~/components/doc/dialog";
import { googleCalendarAddURL, type CalendarFeed } from "~/lib/calendar-types";

export function CalendarCard({ feed, url, children }: { feed: CalendarFeed; url: string; children?: ReactNode }) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const actionData = useActionData<{ ok?: boolean; intent?: string }>();
  const [rotating, setRotating] = useState(false);
  useEffect(() => {
    if (actionData?.intent === "calendar-rotate") setRotating(false);
  }, [actionData]);

  const option = (name: "review" | "loop" | "body") => (
    <label className="flex min-h-10 items-start gap-2 text-sm leading-6">
      <input type="checkbox" name={name} value="1" defaultChecked={feed.include[name]} className="mt-1.5" />
      <span>{t(`apps.calendar.${name}`)}</span>
    </label>
  );

  return (
    <section aria-labelledby="lp-calendar" className="mt-12">
      <h2 id="lp-calendar" className="lp-section">
        {t("apps.calendar.title")}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("apps.calendar.lead")}
      </div>

      <div className="mt-4 rounded-md border px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href={googleCalendarAddURL(url)} target="_blank" rel="noreferrer">
              <CalendarPlus aria-hidden="true" />
              {t("apps.calendar.addGoogle")}
            </a>
          </Button>
          <CopyText text={url} className="h-9 px-3 text-sm" />
        </div>

        <label className="mt-4 block text-sm font-medium" htmlFor="lp-calendar-url">
          {t("apps.calendar.urlLabel")}
        </label>
        <input
          id="lp-calendar-url"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-describedby="lp-calendar-url-hint"
          className="mt-1 h-10 w-full rounded-md border bg-sunken px-3 font-mono text-xs"
        />
        <div id="lp-calendar-url-hint" className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("apps.calendar.urlHint")}
        </div>

        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="calendar-options" />
          <fieldset>
            <legend className="text-sm font-medium">{t("apps.calendar.optionsTitle")}</legend>
            <div className="mt-1">
              {option("review")}
              {option("loop")}
              {option("body")}
              <label className="flex min-h-10 items-start gap-2 text-sm leading-6">
                <input
                  type="checkbox"
                  name="named"
                  value="1"
                  defaultChecked={feed.named}
                  className="mt-1.5"
                  aria-describedby="lp-calendar-named-hint"
                />
                <span>
                  {t("apps.calendar.named")}
                  <span id="lp-calendar-named-hint" className="block text-xs text-muted-foreground">
                    {t("apps.calendar.namedHint")}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {t("apps.calendar.save")}
            </Button>
            {actionData?.ok && actionData.intent === "calendar-options" ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t("apps.calendar.saved")}
              </span>
            ) : null}
          </div>
        </Form>

        <div className="mt-6 max-w-(--lp-measure-read) text-xs leading-5 text-muted-foreground">
          {t("apps.calendar.refresh")}{" "}
          {feed.fetched_at ? (
            <>
              {t("apps.calendar.fetched")} <DateText iso={feed.fetched_at} withTime />.
            </>
          ) : (
            t("apps.calendar.neverFetched")
          )}
        </div>
        <div className="mt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRotating(true)}>
            {t("apps.calendar.rotate")}
          </Button>
        </div>
        {children}
      </div>

      <Dialog open={rotating} onClose={() => setRotating(false)} title={t("apps.calendar.rotateTitle")}>
        <p>{t("apps.calendar.rotateBody")}</p>
        <Form method="post" className="mt-4 flex justify-end gap-2">
          <input type="hidden" name="intent" value="calendar-rotate" />
          <Button type="button" variant="ghost" onClick={() => setRotating(false)}>
            {t("apps.calendar.keep")}
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            {t("apps.calendar.rotateConfirm")}
          </Button>
        </Form>
      </Dialog>
    </section>
  );
}
