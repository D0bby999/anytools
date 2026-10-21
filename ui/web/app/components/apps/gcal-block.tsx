/**
 * gcal-block.tsx
 * The study calendar card's second way (learning-tool-connections phase 3):
 * an AnyLearn calendar in the learner's Google Calendar, written hourly
 * under calendar.app.created. Its four states follow the grant: Google not
 * connected, the calendar permission not given (or still waiting for
 * Google's approval), given but no calendar yet, and writing.
 */
import { useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { DateText } from "~/components/ui/date-text";
import { Dialog } from "~/components/doc/dialog";
import { addFeatureHref } from "~/components/apps/google-features";
import type { GCalLink } from "~/lib/calendar-types";
import type { GoogleFeature } from "~/lib/drive-types";

export function GCalBlock({ connected, feature, link }: { connected: boolean; feature?: GoogleFeature; link: GCalLink | null }) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const actionData = useActionData<{ intent?: string; ok?: boolean; error?: string }>();
  const [stopping, setStopping] = useState(false);
  const failed = actionData && !actionData.ok && actionData.intent?.startsWith("gcal-") ? actionData.error : null;

  let body;
  if (!connected) {
    body = <div className="text-sm text-muted-foreground">{t("apps.gcal.needsGoogle")}</div>;
  } else if (!feature?.granted) {
    body = feature?.available ? (
      <Button asChild variant="outline" size="sm">
        <a href={addFeatureHref("calendar")}>{t("apps.gcal.turnOn")}</a>
      </Button>
    ) : (
      <div className="text-sm text-muted-foreground">{t("apps.gcal.pending")}</div>
    );
  } else if (!link) {
    body = (
      <Form method="post">
        <input type="hidden" name="intent" value="gcal-enable" />
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          {t("apps.gcal.create")}
        </Button>
      </Form>
    );
  } else {
    body = (
      <>
        <div className="text-sm">
          {t("apps.gcal.on")}{" "}
          {link.synced_at ? (
            <span className="text-muted-foreground">
              {t("apps.gcal.synced")} <DateText iso={link.synced_at} withTime />
            </span>
          ) : null}
        </div>
        {link.last_error ? (
          <div className="mt-1 text-sm text-destructive">{t("apps.gcal.error", { error: link.last_error })}</div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Form method="post">
            <input type="hidden" name="intent" value="gcal-sync" />
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {t("apps.gcal.syncNow")}
            </Button>
          </Form>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStopping(true)}>
            {t("apps.gcal.stop")}
          </Button>
        </div>
        <Dialog open={stopping} onClose={() => setStopping(false)} title={t("apps.gcal.stopTitle")}>
          <p>{t("apps.gcal.stopBody")}</p>
          <Form method="post" className="mt-4" onSubmit={() => setStopping(false)}>
            <input type="hidden" name="intent" value="gcal-disable" />
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="remove" value="1" />
              {t("apps.gcal.remove")}
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setStopping(false)}>
                {t("apps.gcal.keep")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                {t("apps.gcal.stopConfirm")}
              </Button>
            </div>
          </Form>
        </Dialog>
      </>
    );
  }

  const known = ["api_disabled", "scope_missing", "needs_reconnect", "google_failed"];
  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-medium">{t("apps.gcal.title")}</h3>
      <div className="mt-1 mb-3 max-w-(--lp-measure-read) text-xs leading-5 text-muted-foreground">{t("apps.gcal.body")}</div>
      {body}
      {failed ? (
        <div role="alert" className="mt-2 text-sm text-destructive">
          {t(`apps.gcal.errors.${known.includes(failed) ? failed : "generic"}`)}
        </div>
      ) : null}
    </div>
  );
}
