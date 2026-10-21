/**
 * apps.tsx
 * Mine → Learning apps (learning-tool-connections): every tool AnyLearn
 * connects to, in one place. Google first, as one account whose features
 * each ask for their own permission, then the tools outside Google.
 *
 * A section whose status the API could not produce shows its own sentence;
 * it does not take the page down with it.
 */
import { data, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/apps";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { disconnectDrive, loadDrive, type DriveAvailability } from "~/lib/drive.server";
import { parseDriveNotice } from "~/lib/drive-types";
import { PageHeader } from "~/components/ui/page-header";
import { DriveNoticeLine } from "~/components/knowledge/drive-grants";
import { GoogleCard } from "~/components/apps/google-features";
import { CalendarCard } from "~/components/apps/calendar-card";
import {
  calendarFeedURL,
  getCalendarFeed,
  rotateCalendarFeed,
  updateCalendarFeed,
} from "~/lib/calendar.server";
import type { CalendarFeed } from "~/lib/calendar-types";
import { EmailCard } from "~/components/apps/email-card";
import { getInbound, rotateInbound, setInboundKB } from "~/lib/inbound.server";
import type { InboundView } from "~/lib/inbound-types";
import { listKBs } from "~/lib/kb.server";
import type { MineKB } from "~/lib/mine";
import { WorkspaceCard } from "~/components/apps/workspace-card";
import { exportForm, importForm, importSheet, previewSheet } from "~/lib/workspace.server";
import type { WorkspaceResult } from "~/lib/workspace-types";
import { studiedLanguages } from "~/lib/vocab.server";
import { ApiError } from "~/lib/api.server";
import { GCalBlock } from "~/components/apps/gcal-block";
import { gcalDisable, gcalEnable, gcalStatus, gcalSync } from "~/lib/gcal.server";
import type { GCalLink } from "~/lib/calendar-types";
import { MediaCard } from "~/components/apps/media-card";
import { addPlaylist, pollPhotos, previewPlaylist, startPhotos, takePhotos } from "~/lib/media.server";
import type { MediaResult } from "~/lib/media-types";
import { AppNoticeLine, CanvaCard, NotionCard } from "~/components/apps/third-party-cards";
import { appStatus, canvaDesigns, canvaImport, disconnectApp, notionImport, notionPages, notionSync } from "~/lib/apps.server";
import { parseAppNotice, type AppsResult, type AppStatus, type NotionImported, type NotionPage } from "~/lib/apps-types";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Learning apps") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  let drive: DriveAvailability = null;
  let driveUnavailable = false;
  try {
    drive = await loadDrive(user.id);
  } catch {
    driveUnavailable = true;
  }
  let calendar: { feed: CalendarFeed; url: string } | null = null;
  try {
    const feed = await getCalendarFeed(user.id);
    calendar = { feed, url: calendarFeedURL(feed.token) };
  } catch {
    calendar = null;
  }
  let email: InboundView | null = null;
  let kbs: MineKB[] = [];
  try {
    const [view, list] = await Promise.all([getInbound(user.id), listKBs(user.id)]);
    email = view;
    kbs = list.knowledge_bases.map(({ kb }) => ({ id: kb.id, name: kb.name }));
  } catch {
    email = null;
  }
  const languages = await studiedLanguages(user.id)
    .then((s) => s.studied)
    .catch(() => [] as string[]);
  const gcal: GCalLink | null = drive?.status.connected
    ? await gcalStatus(user.id)
        .then((r) => r.link)
        .catch(() => null)
    : null;
  const [canva, notion] = await Promise.all(
    (["canva", "notion"] as const).map((p) => appStatus(user.id, p).catch(() => null as AppStatus | null)),
  );
  let notionData: { pages: NotionPage[]; imported: NotionImported[] } = { pages: [], imported: [] };
  if (notion?.connected && !notion.needs_reconnect) {
    notionData = await notionPages(user.id).catch(() => notionData);
  }
  return { drive, driveUnavailable, calendar, email, kbs, languages, gcal, canva, notion, notionData };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const on = (name: string) => form.get(name) === "1";
  if (intent.startsWith("canva-") || intent.startsWith("notion-") || intent === "app-disconnect") {
    return data(await thirdParty(user.id, intent, form));
  }
  if (intent.startsWith("playlist-") || intent.startsWith("photos-")) {
    return data(await media(user.id, intent, form));
  }
  if (intent.startsWith("forms-") || intent.startsWith("sheet-")) {
    return data(await workspace(user.id, intent, form));
  }
  if (intent.startsWith("gcal-")) {
    try {
      if (intent === "gcal-enable") await gcalEnable(user.id);
      else if (intent === "gcal-sync") await gcalSync(user.id);
      else if (intent === "gcal-disable") await gcalDisable(user.id, form.get("remove") === "1");
      return data({ ok: true, intent });
    } catch (error) {
      if (error instanceof ApiError) return data({ ok: false, intent, error: error.code ?? "generic" });
      throw error;
    }
  }
  switch (intent) {
    case "drive-disconnect":
      await disconnectDrive(user.id);
      return data({ ok: true, intent });
    case "calendar-options":
      await updateCalendarFeed(user.id, on("named"), { review: on("review"), loop: on("loop"), body: on("body") });
      return data({ ok: true, intent });
    case "email-target": {
      const kbId = String(form.get("kb_id") ?? "");
      if (kbId) await setInboundKB(user.id, kbId);
      return data({ ok: true, intent });
    }
    case "email-rotate":
      await rotateInbound(user.id);
      return data({ ok: true, intent });
    case "calendar-rotate":
      await rotateCalendarFeed(user.id);
      return data({ ok: true, intent });
    default:
      return data({ ok: false, intent }, { status: 400 });
  }
}

/** Canva and Notion: each answer names its intent, and a refusal its code. */
async function thirdParty(userId: string, intent: string, form: FormData): Promise<AppsResult> {
  const str = (name: string) => String(form.get(name) ?? "");
  try {
    switch (intent) {
      case "app-disconnect": {
        const p = str("provider");
        if (p !== "canva" && p !== "notion") return { intent, ok: false, error: "generic" };
        await disconnectApp(userId, p);
        return { intent, ok: true };
      }
      case "canva-search":
        return { intent, ok: true, designs: (await canvaDesigns(userId, str("query"))).designs };
      case "canva-import": {
        const res = await canvaImport(userId, str("kb_id"), str("design_id"));
        return { intent, ok: true, title: res.title, kbId: res.kb_id };
      }
      case "notion-import": {
        const res = await notionImport(userId, str("kb_id"), form.getAll("page").map(String));
        return { intent, ok: true, imported: res.imported, failed: res.failed, kbId: str("kb_id") };
      }
      case "notion-sync":
        return { intent, ok: true, changed: (await notionSync(userId)).changed };
    }
    return { intent, ok: false, error: "generic" };
  } catch (error) {
    if (error instanceof ApiError) return { intent, ok: false, error: error.code ?? "generic" };
    throw error;
  }
}

/** Playlists and Photos: each answer names its intent, and a refusal its code. */
async function media(userId: string, intent: string, form: FormData): Promise<MediaResult> {
  const str = (name: string) => String(form.get(name) ?? "");
  try {
    switch (intent) {
      case "playlist-preview":
        return { intent, ok: true, url: str("url"), playlist: await previewPlaylist(userId, str("url")) };
      case "playlist-add": {
        const res = await addPlaylist(userId, str("kb_id"), str("url"), form.getAll("video").map(String));
        return { intent, ok: true, added: res.added, kbId: res.kb_id };
      }
      case "photos-start":
        return { intent, ok: true, session: await startPhotos(userId) };
      case "photos-poll":
        return { intent, ok: true, session: await pollPhotos(userId, str("session_id")) };
      case "photos-take": {
        const res = await takePhotos(userId, str("kb_id"), str("session_id"));
        return { intent, ok: true, photos: res.photos, kbId: res.kb_id };
      }
    }
    return { intent, ok: false, error: "generic" };
  } catch (error) {
    if (error instanceof ApiError) return { intent, ok: false, error: error.code ?? "generic" };
    throw error;
  }
}

/** Forms and Sheets: each answer names its intent, and a refusal its code. */
async function workspace(userId: string, intent: string, form: FormData): Promise<WorkspaceResult> {
  const str = (name: string) => String(form.get(name) ?? "");
  try {
    switch (intent) {
      case "forms-import":
        return { intent, ok: true, report: await importForm(userId, str("kb_id"), str("form_id")) };
      case "forms-export":
        return { intent, ok: true, report: await exportForm(userId, str("kb_id"), str("title")) };
      case "sheet-preview":
        return { intent, ok: true, fileId: str("file_id"), preview: await previewSheet(userId, str("file_id")) };
      case "sheet-import":
        return {
          intent,
          ok: true,
          report: await importSheet(userId, str("lang"), {
            file_id: str("file_id"),
            term: Number(str("term")),
            meaning: Number(str("meaning")),
            example: Number(str("example") || "-1"),
            header: str("header") === "1",
          }),
        };
    }
    return { intent, ok: false, error: "generic" };
  } catch (error) {
    if (error instanceof ApiError) return { intent, ok: false, error: error.code ?? "generic" };
    throw error;
  }
}

export default function Apps({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const notice = parseDriveNotice(searchParams.get("drive"));
  const { drive, calendar, email, kbs, languages, gcal, canva, notion, notionData } = loaderData;
  const appNotice = parseAppNotice(searchParams.get("app"));

  return (
    <div>
      <PageHeader title={t("apps.title")} lede={t("apps.lead")} />
      {notice ? <DriveNoticeLine notice={notice} /> : null}
      {appNotice ? <AppNoticeLine provider={appNotice.provider} notice={appNotice.notice} /> : null}

      {drive ? (
        <GoogleCard status={drive.status} />
      ) : (
        <p className="mt-10 text-sm leading-prose text-muted-foreground">{t("settings.connections.drive.unavailable")}</p>
      )}

      {drive ? (
        <WorkspaceCard picker={drive.picker} connected={drive.status.connected} kbs={kbs} languages={languages} />
      ) : null}
      <MediaCard kbs={kbs} photos={drive?.status.connected ? drive.status.features?.find((f) => f.id === "photos") : undefined} />
      {calendar ? (
        <CalendarCard feed={calendar.feed} url={calendar.url}>
          {drive ? (
            <GCalBlock
              connected={drive.status.connected}
              feature={drive.status.features?.find((f) => f.id === "calendar")}
              link={gcal}
            />
          ) : null}
        </CalendarCard>
      ) : null}
      {email ? <EmailCard view={email} kbs={kbs} /> : null}
      {canva ? <CanvaCard status={canva} kbs={kbs} /> : null}
      {notion ? <NotionCard status={notion} kbs={kbs} pages={notionData.pages} imported={notionData.imported} /> : null}
    </div>
  );
}
