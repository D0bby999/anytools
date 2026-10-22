/**
 * A method's videos (the private design notes): each a button that
 * swaps itself for YouTube's privacy-enhanced player, so nothing loads from
 * YouTube until the learner presses play (a plain iframe on
 * www.youtube-nocookie.com, which the CSP's frame-src already allows; no
 * thumbnails, so img-src is unchanged). "Add to my knowledge" sends the
 * video through the link import, whose captions become a document.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { languageName } from "~/lib/languages";
import { playerURL, type MethodVideo } from "~/lib/methods";
import { StatusLine } from "~/components/doc/status-line";
import { Button } from "~/components/ui/button";

const LINK = "text-primary underline underline-offset-4";

export type SaveResult = { video: string; kbId?: string; kbName?: string; error?: string };

function Video({ video }: { video: MethodVideo }) {
  const { t, i18n } = useTranslation("methods");
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  // The play button is gone once pressed: focus goes to the player that
  // replaced it, not to the top of the page.
  useEffect(() => {
    if (playing) player.current?.focus();
  }, [playing]);
  const fetcher = useFetcher<SaveResult>();
  const saved = fetcher.data?.video === video.id ? fetcher.data : null;
  const meta = t("videos.meta", {
    channel: video.channel,
    minutes: Math.max(1, Math.round(video.seconds / 60)),
    language: languageName(video.lang, i18n.language),
  });
  return (
    <li className="rounded border border-border bg-card p-3">
      {playing ? (
        <div className="aspect-video w-full overflow-hidden rounded bg-sunken">
          <iframe
            ref={player}
            src={playerURL(video.id)}
            title={video.title}
            lang={video.lang}
            className="size-full"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t("videos.play", { title: video.title })}
          className="flex aspect-video w-full items-center justify-center rounded bg-sunken text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Play aria-hidden="true" className="size-10" />
        </button>
      )}
      <p className="mt-2 font-medium" lang={video.lang}>
        {video.title}
      </p>
      <p className="text-sm text-muted-foreground">{meta}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t("videos.watch")}
          {" "}
          <span className="sr-only">{t("newTab")}</span>
        </a>
        {saved?.kbId ? (
          <span className="text-muted-foreground">{t("videos.added")}</span>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="video" value={video.id} />
            <Button type="submit" variant="outline" size="sm" disabled={fetcher.state !== "idle"}>
              {t("videos.save")}
            </Button>
          </fetcher.Form>
        )}
      </div>
      <StatusLine tone={saved?.error ? "error" : "info"}>
        {saved?.kbId ? (
          <>
            {t("videos.saved", { kb: saved.kbName })}{" "}
            <Link to={`/knowledge/${saved.kbId}`} className={LINK}>
              {t("videos.openKB")}
            </Link>
          </>
        ) : saved?.error ? (
          t("videos.failed", { detail: saved.error === "not_listed" ? t("videos.notListed") : saved.error })
        ) : null}
      </StatusLine>
    </li>
  );
}

export function VideoList({ videos, ui, search }: { videos: MethodVideo[]; ui: string; search: string }) {
  const { t } = useTranslation("methods");
  const mine = videos.some((v) => v.lang === ui);
  return (
    <>
      {ui !== "en" && !mine ? <p className="mt-2 text-sm text-muted-foreground">{t("videos.none")}</p> : null}
      <ul className="mt-3 grid gap-4 sm:grid-cols-2">
        {videos.map((v) => (
          <Video key={v.id} video={v} />
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <a href={search} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t("videos.search")}
          {" "}
          <span className="sr-only">{t("newTab")}</span>
        </a>
      </p>
    </>
  );
}
