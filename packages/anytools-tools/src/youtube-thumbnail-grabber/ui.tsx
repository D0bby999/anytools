'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { type SyntheticEvent, useMemo, useRef, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  THUMBNAIL_ORDER,
  THUMBNAIL_SIZES,
  type ThumbnailKey,
  fetchThumbnailBlob,
  parseYouTubeId,
  thumbnailUrl,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'youtube-thumbnail-grabber';

export function YoutubeThumbnailGrabberUi() {
  const s = useLocalized(STRINGS);
  const [input, setInput] = useState('');
  const videoId = useMemo(() => parseYouTubeId(input), [input]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{s.urlLabel}</span>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={s.urlPlaceholder}
            className="font-mono"
          />
        </label>

        {input.trim() && !videoId && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {s.error_notFound}
          </output>
        )}

        {/* Keyed by videoId so pasting a new link starts with a fresh hero index and download
            note, instead of an effect resetting state a render behind the new id. */}
        {videoId && <ThumbnailPanel key={videoId} videoId={videoId} />}

        <PrivacyNote message={s.privacyNote.replace('{name}', 'i.ytimg.com')} />
      </CardContent>
    </Card>
  );
}

function ThumbnailPanel({ videoId }: { videoId: string }) {
  const s = useLocalized(STRINGS);
  const objectUrls = useObjectUrls();
  // Index into THUMBNAIL_ORDER for the hero preview. Starts at the highest quality and steps
  // down on <img onError> — see logic.ts for why this is reliable (verified 404 behavior).
  const [heroIndex, setHeroIndex] = useState(0);
  const [downloadingKey, setDownloadingKey] = useState<ThumbnailKey | null>(null);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const counted = useRef(false);

  const countRun = () => {
    if (counted.current) return;
    counted.current = true;
    trackEvent('tool_run', { tool: SLUG });
  };

  const heroKey = THUMBNAIL_ORDER[heroIndex];

  // A missing size does not fail to load — YouTube answers with a decodable 120×90 grey
  // placeholder JPEG on a 404, so `onLoad` fires normally. `naturalWidth` catches that case (the
  // real sizes start at 320×180); `onError` stays as a backstop for a genuinely broken fetch.
  const advance = () => setHeroIndex((i) => Math.min(i + 1, THUMBNAIL_ORDER.length - 1));
  const handleHeroLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    if (e.currentTarget.naturalWidth <= 120 && e.currentTarget.naturalHeight <= 90) advance();
  };

  const handleDownload = async (key: ThumbnailKey) => {
    const url = thumbnailUrl(videoId, key);
    setDownloadingKey(key);
    setDownloadNote(null);
    try {
      const blob = await fetchThumbnailBlob(url);
      const objectUrl = objectUrls.create(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${videoId}-${key}.jpg`;
      a.click();
      countRun();
    } catch (e) {
      // Fetch failed for a reason other than "this size doesn't exist" (offline, an extension
      // or the site's own Content-Security-Policy blocking the cross-origin request) — the
      // image itself is still reachable as a normal navigation, so fall back to opening it
      // directly rather than leaving the user with nothing.
      setDownloadNote(toolErrorText(e, s, s.downloadFailedNote));
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadingKey(null);
    }
  };

  if (!heroKey) return null;

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1.5 block text-sm font-medium">{s.preview}</span>
        <img
          src={thumbnailUrl(videoId, heroKey)}
          alt=""
          className="w-full max-w-md rounded-lg border"
          onLoad={handleHeroLoad}
          onError={advance}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THUMBNAIL_ORDER.map((key) => {
          const { width, height } = THUMBNAIL_SIZES[key];
          return (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="h-auto flex-col gap-0.5 py-2"
              onClick={() => handleDownload(key)}
              disabled={downloadingKey !== null}
            >
              <span>
                {s[`resolution_${key}`]} · {width}×{height}
              </span>
              <span className="text-xs text-muted-foreground">
                {downloadingKey === key ? '…' : s.download}
              </span>
            </Button>
          );
        })}
      </div>

      {downloadNote && <p className="text-xs text-muted-foreground">{downloadNote}</p>}
    </div>
  );
}
