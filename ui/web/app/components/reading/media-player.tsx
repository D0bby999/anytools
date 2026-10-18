import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { isVideoRecording, recordingURL, type KBDocument } from "~/lib/kb-types";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";

/**
 * media-player.tsx
 * An uploaded audio or video file (up-methods phase 15), played by the
 * browser's own <audio> or <video> from this origin (documents.$docId.media,
 * the CSP's media-src 'self').
 *
 * Unlike YouTube's iframe, a native element tells the page where it is:
 * seeking sets `currentTime`, and the playhead is read back, so the viewer's
 * current transcript line follows the sound and "Now" asks about the moment
 * actually playing.
 */

/** What the viewer can do with the player. */
export type MediaHandle = {
  /** Move the playhead; play when asked. */
  seek: (seconds: number, play?: boolean) => void;
  /** Where the playhead is, in seconds. */
  now: () => number;
  /** Stop playing (a replayed segment reached its end). */
  pause: () => void;
};

export function MediaPlayer({
  document: doc,
  initialSeconds,
  onTime,
  ref,
}: {
  document: KBDocument;
  initialSeconds: number;
  /** The playhead, as it moves (timeupdate, seeked). */
  onTime?: (seconds: number) => void;
  ref?: Ref<MediaHandle>;
}) {
  const { t } = useTranslation("knowledge");
  const element = useRef<HTMLMediaElement | null>(null);
  const video = isVideoRecording(doc);
  // A recording kept in the learner's Drive says why it will not play
  // (drive-user-storage phase 3).
  const [reason, checkReason] = useDriveReason();

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds, play = false) => {
        const el = element.current;
        if (!el) return;
        el.currentTime = Math.max(0, seconds);
        if (play) void el.play()?.catch(() => {});
      },
      now: () => element.current?.currentTime ?? 0,
      pause: () => element.current?.pause(),
    }),
    [],
  );

  // A cited second: once the browser knows the file's length, the playhead
  // starts there (before then, setting it may be ignored).
  useEffect(() => {
    const el = element.current;
    if (!el || initialSeconds <= 0) return;
    const start = () => {
      el.currentTime = initialSeconds;
    };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });
    return () => el.removeEventListener("loadedmetadata", start);
  }, [initialSeconds]);

  const report = (event: React.SyntheticEvent<HTMLMediaElement>) => onTime?.(event.currentTarget.currentTime);
  const common = {
    src: recordingURL(doc.id),
    controls: true,
    preload: "metadata" as const,
    onTimeUpdate: report,
    onSeeked: report,
    onError: () => checkReason(recordingURL(doc.id)),
    "aria-label": t("media.player", { title: doc.title }),
  };

  const notice = reason ? <DriveFileNotice reason={reason} className="mt-2" /> : null;
  return video ? (
    <>
      <div className="w-full overflow-hidden rounded-lg border bg-sunken">
        <video
          {...common}
          ref={(el) => {
            element.current = el;
          }}
          playsInline
          className="aspect-video w-full"
        />
      </div>
      {notice}
    </>
  ) : (
    <>
      <audio
        {...common}
        ref={(el) => {
          element.current = el;
        }}
        className="w-full"
      />
      {notice}
    </>
  );
}
