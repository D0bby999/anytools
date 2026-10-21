/**
 * google-features.tsx
 * The Google card on Learning apps (learning-tool-connections phase 1): the
 * account, then one row per feature, what it does, whether it is on, and the
 * one action that turns it on. Every row asks Google for its own scopes on
 * top of the grant Drive holds (`/auth/drive?add=<id>`); a sensitive feature
 * not yet offered to this learner says it is waiting for Google's approval.
 *
 * Disconnect ends the whole grant (Google revokes tokens, not scopes), so
 * there is one, on the account row, and its confirmation names that.
 */
import { CalendarDays, FolderOpen, GraduationCap, Images, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/doc/badge";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import { DriveDisconnect, driveStatusTone } from "~/components/settings/drive-connection-card";
import type { DriveStatus, GoogleFeature } from "~/lib/drive-types";

const ICONS: Record<GoogleFeature["id"], LucideIcon> = {
  drive: FolderOpen,
  calendar: CalendarDays,
  classroom: GraduationCap,
  photos: Images,
};

/** The consent URL that adds one feature, coming back to `next`. */
export function addFeatureHref(id: GoogleFeature["id"], next = "/apps"): string {
  const add = id === "drive" ? "" : `&add=${id}`;
  return `/auth/drive?next=${encodeURIComponent(next)}${add}`;
}

export function GoogleCard({ status, children }: { status: DriveStatus; children?: ReactNode }) {
  const { t } = useTranslation("common");
  const features = status.features ?? [];
  const tone = driveStatusTone(status);
  return (
    <section aria-labelledby="lp-google" className="mt-10">
      <h2 id="lp-google" className="lp-section">
        {t("apps.google.title")}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("apps.google.lead")}
      </div>

      <div className="mt-4 rounded-md border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex flex-wrap items-baseline gap-x-2 font-medium">
              {t("apps.google.account")}
              <StatusPill
                status={tone}
                label={
                  !status.connected
                    ? t("apps.google.notConnected")
                    : tone === "blocked"
                      ? t("settings.readiness.blocked")
                      : tone === "warn"
                        ? t("settings.readiness.attention")
                        : t("apps.google.connected")
                }
              />
            </div>
            {status.email ? <div className="mt-1 text-sm text-muted-foreground">{status.email}</div> : null}
            {status.needs_reconnect ? (
              <div className="mt-1 text-sm leading-prose text-destructive">
                {t("settings.connections.drive.needsReconnect")}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!status.connected || status.needs_reconnect ? (
              // A document navigation: /auth/drive redirects to Google.
              <Button asChild size="sm">
                <a href={addFeatureHref("drive")}>
                  {status.connected ? t("apps.google.reconnect") : t("apps.google.connect")}
                </a>
              </Button>
            ) : null}
            {status.connected ? (
              <DriveDisconnect
                status={status}
                label={t("apps.google.disconnect")}
                extra={<p className="mb-4">{t("apps.google.disconnectAll")}</p>}
              />
            ) : null}
          </div>
        </div>

        <ul aria-label={t("apps.google.title")} className="divide-y divide-border border-t">
          {features.map((feature) => (
            <FeatureRow key={feature.id} feature={feature} status={status} />
          ))}
        </ul>
      </div>

      <div className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("apps.google.throughDrive")}
      </div>
      {children}
    </section>
  );
}

function FeatureRow({ feature, status }: { feature: GoogleFeature; status: DriveStatus }) {
  const { t } = useTranslation("common");
  const Icon = ICONS[feature.id];
  const on = status.connected && feature.granted;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-deco" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-baseline gap-x-2 font-medium">
          {t(`apps.google.features.${feature.id}.name`)}
          {on ? (
            <Badge type="tip">{t("apps.google.on")}</Badge>
          ) : !feature.available ? (
            <Badge type="info">{t("apps.google.pending")}</Badge>
          ) : (
            <Badge type="info">{t("apps.google.off")}</Badge>
          )}
        </div>
        <div className="mt-1 text-sm leading-prose text-muted-foreground">
          {t(`apps.google.features.${feature.id}.body`)}
          {feature.id === "drive" && on ? ` ${t("apps.google.driveFiles", { count: status.grants })}.` : null}
        </div>
      </div>
      {!on && feature.available && status.connected ? (
        <Button asChild variant="outline" size="sm">
          <a href={addFeatureHref(feature.id)}>{t("apps.google.turnOn")}</a>
        </Button>
      ) : on && feature.id === "classroom" ? (
        <Button asChild variant="outline" size="sm">
          <Link to="/apps/classroom">{t("apps.google.openClassroom")}</Link>
        </Button>
      ) : null}
    </li>
  );
}
