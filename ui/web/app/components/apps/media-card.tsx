/**
 * media-card.tsx
 * Learning apps → YouTube and Google Photos (learning-tool-connections
 * phase 7). A playlist link lists its videos, all ticked; the kept ones are
 * added in order, each as a video link. Google Photos: a picker session is
 * made, Google's own window is opened for the learner to pick in, this page
 * polls until Google says the set is ready, then the photos are filed as
 * page photos.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Images, ListVideo } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
import type { MediaResult } from "~/lib/media-types";
import type { GoogleFeature } from "~/lib/drive-types";
import type { MineKB } from "~/lib/mine";

const ERRORS = ["not_a_playlist", "unavailable", "youtube_failed", "api_disabled", "session_gone", "no_photos", "popup"];

function ErrorLine({ code }: { code: string }) {
  const { t } = useTranslation("common");
  return (
    <div role="alert" className="mt-2 text-sm text-destructive">
      {t(`apps.media.errors.${ERRORS.includes(code) ? code : "generic"}`)}
    </div>
  );
}

export function MediaCard({ kbs, photos }: { kbs: MineKB[]; photos?: GoogleFeature }) {
  const { t } = useTranslation("common");
  const [kbId, setKbId] = useState(kbs[0]?.id ?? "");
  if (kbs.length === 0) return null;
  return (
    <section aria-labelledby="lp-media" className="mt-12">
      <h2 id="lp-media" className="lp-section">
        {t("apps.media.title")}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("apps.media.lead")}</div>
      <div className="mt-4 rounded-md border px-4 py-4">
        <div className="max-w-sm [&_.lp-field]:mt-0">
          <Field label={t("apps.media.kb")}>
            <select value={kbId} onChange={(e) => setKbId(e.target.value)}>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PlaylistBlock kbId={kbId} />
        <PhotosBlock kbId={kbId} feature={photos} />
      </div>
    </section>
  );
}

function PlaylistBlock({ kbId }: { kbId: string }) {
  const { t } = useTranslation("common");
  const preview = useFetcher<MediaResult>();
  const add = useFetcher<MediaResult>();
  const shown = preview.data?.ok && preview.data.intent === "playlist-preview" ? preview.data : null;
  const [kept, setKept] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (shown) setKept(new Set(shown.playlist.videos.map((v) => v.id)));
  }, [shown]);
  const busy = preview.state !== "idle" || add.state !== "idle";
  const done = add.data?.ok && add.data.intent === "playlist-add" ? add.data : null;

  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <ListVideo aria-hidden="true" className="size-4 text-deco" />
        {t("apps.media.playlistTitle")}
      </h3>
      <preview.Form method="post" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="intent" value="playlist-preview" />
        <div className="min-w-0 flex-1 basis-72 [&_.lp-field]:mb-0">
          <Field label={t("apps.media.playlistUrl")}>
            <input
              name="url"
              type="url"
              inputMode="url"
              required
              aria-describedby="lp-playlist-hint"
              placeholder="https://www.youtube.com/playlist?list=…"
            />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={busy}>
          {t("apps.media.preview")}
        </Button>
        <div id="lp-playlist-hint" className="w-full text-xs text-muted-foreground">
          {t("apps.media.playlistHint")}
        </div>
      </preview.Form>
      {preview.data && !preview.data.ok ? <ErrorLine code={preview.data.error} /> : null}

      {shown ? (
        <add.Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="playlist-add" />
          <input type="hidden" name="kb_id" value={kbId} />
          <input type="hidden" name="url" value={shown.url} />
          <div className="text-sm font-medium">
            {t("apps.media.videos", { title: shown.playlist.title, count: shown.playlist.videos.length })}
          </div>
          {shown.playlist.truncated ? <div className="text-xs text-muted-foreground">{t("apps.media.truncated")}</div> : null}
          <ol className="mt-2 max-h-72 overflow-y-auto rounded-md border text-sm" tabIndex={0} aria-label={shown.playlist.title}>
            {shown.playlist.videos.map((v, i) => (
              <li key={v.id} className="border-b last:border-b-0">
                <label className="flex min-h-10 items-center gap-3 px-3 py-1">
                  <input
                    type="checkbox"
                    name="video"
                    value={v.id}
                    checked={kept.has(v.id)}
                    onChange={() =>
                      setKept((prev) => {
                        const next = new Set(prev);
                        if (next.has(v.id)) next.delete(v.id);
                        else next.add(v.id);
                        return next;
                      })
                    }
                  />
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 truncate">{v.title}</span>
                </label>
              </li>
            ))}
          </ol>
          <Button type="submit" size="sm" className="mt-2" disabled={busy || kept.size === 0}>
            {t("apps.media.addVideos", { count: kept.size })}
          </Button>
        </add.Form>
      ) : null}
      {add.data && !add.data.ok ? <ErrorLine code={add.data.error} /> : null}
      {done ? (
        <div role="status" className="mt-2 text-sm">
          {t("apps.media.added", { added: done.added })} <Link to={`/knowledge/${done.kbId}`}>{t("apps.media.openKb")}</Link>
        </div>
      ) : null}
    </div>
  );
}

function PhotosBlock({ kbId, feature }: { kbId: string; feature?: GoogleFeature }) {
  const { t } = useTranslation("common");
  const step = useFetcher<MediaResult>();
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const result = step.data;
  const session = result?.ok && (result.intent === "photos-start" || result.intent === "photos-poll") ? result.session : null;
  const done = result?.ok && result.intent === "photos-take" ? result : null;

  // Once a session exists: send the open window to Google's picker, then ask
  // every poll interval whether the learner is done, and take the photos.
  useEffect(() => {
    if (!session || step.state !== "idle") return;
    if (result?.intent === "photos-start" && popup.current) popup.current.location.href = session.picker_uri;
    if (session.ready) {
      step.submit({ intent: "photos-take", kb_id: kbId, session_id: session.id }, { method: "post" });
      return;
    }
    const timer = window.setTimeout(
      () => step.submit({ intent: "photos-poll", session_id: session.id }, { method: "post" }),
      Math.max(2000, session.poll_ms),
    );
    return () => window.clearTimeout(timer);
  }, [session, step, result, kbId]);

  function pick() {
    setError(null);
    // Opened in the click itself, or the browser blocks it.
    popup.current = window.open("about:blank", "anylearn-photos", "popup,width=900,height=700");
    if (!popup.current) {
      setError("popup");
      return;
    }
    step.submit({ intent: "photos-start" }, { method: "post" });
  }

  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Images aria-hidden="true" className="size-4 text-deco" />
        {t("apps.media.photosTitle")}
      </h3>
      {!feature?.granted ? (
        <div className="mt-1 text-sm text-muted-foreground">
          {feature && !feature.available ? t("apps.media.photosPending") : t("apps.media.photosOff")}
        </div>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={step.state !== "idle" || Boolean(session && !done)} onClick={pick}>
            {t("apps.media.pickPhotos")}
          </Button>
          {session && !done ? (
            <div role="status" className="mt-2 text-sm text-muted-foreground">
              {t("apps.media.picking")}
            </div>
          ) : null}
        </>
      )}
      {error ? <ErrorLine code={error} /> : null}
      {result && !result.ok ? <ErrorLine code={result.error} /> : null}
      {done ? (
        <div role="status" className="mt-2 text-sm">
          {t("apps.media.photosAdded", { count: done.photos })} <Link to={`/knowledge/${done.kbId}`}>{t("apps.media.openKb")}</Link>
        </div>
      ) : null}
    </div>
  );
}
