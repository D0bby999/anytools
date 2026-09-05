'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type EmbeddableImage, toEmbeddableImage } from '../shared/embeddable-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type WatermarkOptions, type WatermarkResult, readPageCount, watermarkPdf } from './logic';
import { PREVIEW_DPI, renderFirstPage } from './preview';
import { STRINGS } from './strings';

type Preview = { url: string; width: number; height: number };

const fieldClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Widest the preview column gets. The rendered page is scaled to fit this. */
const PREVIEW_MAX_WIDTH = 320;

export function WatermarkPdfUi() {
  const s = useLocalized(STRINGS);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  // Its identity is stable (useMemo, see the hook), so it can be named as an effect dependency
  // like any other value — no latest-ref dance, and no mutation during render.
  const objectUrls = useObjectUrls();

  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState('#808080');
  const [markFiles, setMarkFiles] = useState<File[]>([]);
  const [markImage, setMarkImage] = useState<EmbeddableImage | null>(null);
  const [markUrl, setMarkUrl] = useState<string | null>(null);
  const [scalePercent, setScalePercent] = useState(50);
  const [rotation, setRotation] = useState(45);
  const [opacity, setOpacity] = useState(0.25);
  const [range, setRange] = useState('');

  const [result, setResult] = useState<WatermarkResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;
  const markFile = markFiles[0] ?? null;

  // Object URLs are created and revoked here, not inside a setState updater: React may run an
  // updater more than once (and does, in StrictMode), which would leak one URL per extra call
  // and revoke one that is still on screen.
  const reset = () => {
    objectUrls.revoke(downloadUrl);
    setDownloadUrl(null);
    setResult(null);
    setError(null);
  };

  // Page count and the page-1 render, once per file. The overlay below is CSS, so every
  // slider afterwards is free; re-rendering the page per tick would make them unusable.
  useEffect(() => {
    // The old preview belongs to the old file; showing it beside a new one is worse than a gap.
    setPreview(null);
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : s.couldNotReadPdf));
    renderFirstPage(file)
      .then(({ blob, width, height }) => {
        if (cancelled) return;
        created = objectUrls.create(blob);
        setPreview({ url: created, width, height });
      })
      // A failed preview is not a failed tool — the stamp itself uses pdf-lib, not pdf.js.
      // Drop the preview rather than blocking the run.
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
      objectUrls.revoke(created);
    };
  }, [file, objectUrls, s.couldNotReadPdf]);

  // Decode the watermark image once, when it is chosen, rather than on every run. This also
  // converts WebP and applies EXIF orientation — pdf-lib embeds PNG and JPEG only.
  useEffect(() => {
    setMarkUrl(null);
    if (!markFile) {
      setMarkImage(null);
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    toEmbeddableImage(markFile)
      .then((image) => {
        if (cancelled) return;
        setMarkImage(image);
        // Preview the bytes that will actually be embedded, not the original file: this is
        // what shows a WebP logo, or one whose EXIF rotation has just been applied.
        created = objectUrls.create(
          new Blob([image.bytes.slice()], { type: `image/${image.format}` }),
        );
        setMarkUrl(created);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : s.couldNotReadImage));
    return () => {
      cancelled = true;
      objectUrls.revoke(created);
    };
  }, [markFile, objectUrls, s.couldNotReadImage]);

  const previewScale = preview ? Math.min(1, PREVIEW_MAX_WIDTH / preview.width) : 1;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    reset();
    trackEvent('tool_run', { tool: 'watermark-pdf' });
    try {
      const opts: WatermarkOptions =
        kind === 'text'
          ? { kind: 'text', text, fontSize, color, rotation, opacity, range }
          : markImage
            ? { kind: 'image', image: markImage, scalePercent, rotation, opacity, range }
            : (() => {
                throw new Error(s.chooseImage);
              })();
      const r = await watermarkPdf(file, opts);
      setResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : s.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label={s.dropLabel}
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {(pageCount === 1 ? s.pageCountOne : s.pageCountMany).replace('{n}', String(pageCount))}
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.watermark}</legend>
          <div className="flex gap-4 text-sm">
            {(['text', 'image'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="watermark-kind"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    reset();
                  }}
                  className="h-4 w-4"
                />
                {k === 'text' ? s.kindText : s.kindImage}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            {kind === 'text' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm sm:col-span-2">
                  <span className="font-medium">{s.text}</span>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      reset();
                    }}
                    className={fieldClass}
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">{s.fontSize}</span>
                  <input
                    type="number"
                    min={4}
                    max={200}
                    value={fontSize}
                    onChange={(e) => {
                      setFontSize(Number(e.target.value));
                      reset();
                    }}
                    className={fieldClass}
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-medium">{s.colour}</span>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => {
                      setColor(e.target.value);
                      reset();
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-1"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-4">
                <MultiFileDropzone
                  files={markFiles}
                  onChange={(f) => {
                    setMarkFiles(f);
                    reset();
                  }}
                  accept="image/*"
                  multiple={false}
                  label={s.imageDropLabel}
                />
                <label className="space-y-1 text-sm">
                  <span className="font-medium">
                    {s.width.replace('{n}', String(scalePercent))}
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={scalePercent}
                    onChange={(e) => {
                      setScalePercent(Number(e.target.value));
                      reset();
                    }}
                    className="w-full"
                  />
                </label>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">{s.angle.replace('{n}', String(rotation))}</span>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={5}
                  value={rotation}
                  onChange={(e) => {
                    setRotation(Number(e.target.value));
                    reset();
                  }}
                  className="w-full"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium">
                  {s.opacity.replace('{n}', String(Math.round(opacity * 100)))}
                </span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => {
                    setOpacity(Number(e.target.value) / 100);
                    reset();
                  }}
                  className="w-full"
                />
              </label>

              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium">{s.pagesToStamp}</span>
                <input
                  type="text"
                  value={range}
                  placeholder={
                    pageCount
                      ? s.rangePlaceholderAll.replace('{n}', String(pageCount))
                      : s.rangePlaceholder
                  }
                  onChange={(e) => {
                    setRange(e.target.value);
                    reset();
                  }}
                  className={fieldClass}
                />
              </label>
            </div>
          </div>

          {preview && (
            <figure className="space-y-1">
              <div
                className="relative overflow-hidden rounded-md border bg-white"
                style={{
                  width: preview.width * previewScale,
                  height: preview.height * previewScale,
                }}
              >
                <img
                  src={preview.url}
                  alt={s.previewAlt}
                  className="absolute inset-0 h-full w-full"
                />
                {/* The overlay is CSS, not a second PDF render: moving a slider must not cost
                    a page render. It is an approximation of the output, not the output. */}
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ opacity }}
                >
                  <div
                    style={{
                      transform: `rotate(${-rotation}deg)`,
                      transformOrigin: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {kind === 'text' ? (
                      <span
                        style={{
                          // The page was rendered at PREVIEW_DPI, so one point of font size is
                          // PREVIEW_DPI/72 CSS pixels before the fit-to-column scale.
                          fontSize: fontSize * (PREVIEW_DPI / 72) * previewScale,
                          color,
                          fontFamily: 'Helvetica, Arial, sans-serif',
                        }}
                      >
                        {text}
                      </span>
                    ) : (
                      markUrl && (
                        <img
                          src={markUrl}
                          alt=""
                          style={{ width: preview.width * previewScale * (scalePercent / 100) }}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>
              <figcaption className="text-xs text-muted-foreground">{s.previewCaption}</figcaption>
            </figure>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{s.fontNote}</p>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || (kind === 'image' && !markImage)}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.stamping : s.addWatermark}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm font-medium">
              {(result.pages === 1 ? s.stampedOne : s.stampedMany)
                .replace('{n}', String(result.stamped))
                .replace('{total}', String(result.pages))}
            </div>
            <a
              href={downloadUrl}
              download="watermarked.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.download}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
