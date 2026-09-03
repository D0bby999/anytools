'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { type EmbeddableImage, toEmbeddableImage } from '../shared/embeddable-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type WatermarkOptions,
  type WatermarkResult,
  readPageCount,
  renderFirstPage,
  watermarkPdf,
} from './logic';

type Preview = { url: string; width: number; height: number };

const fieldClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Widest the preview column gets. The rendered page is scaled to fit this. */
const PREVIEW_MAX_WIDTH = 320;

export function WatermarkPdfUi() {
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  // useObjectUrls returns a fresh object literal on every render, so naming it as an effect
  // dependency re-runs the effect on every render — here that would re-render page 1 through
  // pdf.js, set state, and loop forever. The methods are all ref-backed and safe to reach
  // through a ref that is kept current, which is also what stops the lint rule asking for it.
  const urls = useRef(objectUrls);
  urls.current = objectUrls;

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

  const reset = () => {
    setResult(null);
    setError(null);
    setDownloadUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return null;
    });
  };

  // Page count and the page-1 render, once per file. The overlay below is CSS, so every
  // slider afterwards is free; re-rendering the page per tick would make them unusable.
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      setPreview(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read PDF'));
    renderFirstPage(file)
      .then(({ blob, width, height }) => {
        if (cancelled) return;
        setPreview((prev) => {
          if (prev) urls.current.revoke(prev.url);
          return { url: urls.current.create(blob), width, height };
        });
      })
      // A failed preview is not a failed tool — the stamp itself uses pdf-lib, not pdf.js.
      // Drop the preview rather than blocking the run.
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Decode the watermark image once, when it is chosen, rather than on every run. This also
  // converts WebP and applies EXIF orientation — pdf-lib embeds PNG and JPEG only.
  useEffect(() => {
    if (!markFile) {
      setMarkImage(null);
      setMarkUrl((prev) => {
        if (prev) urls.current.revoke(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    toEmbeddableImage(markFile)
      .then((image) => {
        if (cancelled) return;
        setMarkImage(image);
        setMarkUrl((prev) => {
          if (prev) urls.current.revoke(prev);
          // Preview the bytes that will actually be embedded, not the original file: this is
          // what shows a WebP logo, or one whose EXIF rotation has just been applied.
          return urls.current.create(
            new Blob([image.bytes.slice()], { type: `image/${image.format}` }),
          );
        });
      })
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read image'),
      );
    return () => {
      cancelled = true;
    };
  }, [markFile]);

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
                throw new Error('Choose a PNG or JPG to use as the watermark.');
              })();
      const r = await watermarkPdf(file, opts);
      setResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Could not add the watermark');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Watermark PDF</CardTitle>
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
          label="The PDF to stamp. The mark is drawn on top; nothing already on the page is removed."
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Watermark</legend>
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
                {k === 'text' ? 'Text' : 'Image (PNG or JPG)'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            {kind === 'text' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm sm:col-span-2">
                  <span className="font-medium">Text</span>
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
                  <span className="font-medium">Font size</span>
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
                  <span className="font-medium">Colour</span>
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
                  label="The image to stamp. A logo with a transparent background works best."
                />
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Width — {scalePercent}% of the page</span>
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
                <span className="font-medium">Angle — {rotation}°</span>
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
                <span className="font-medium">Opacity — {Math.round(opacity * 100)}%</span>
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
                <span className="font-medium">Pages to stamp</span>
                <input
                  type="text"
                  value={range}
                  placeholder={pageCount ? `all — or e.g. 1-${pageCount}` : 'all — or e.g. 1-5, 9'}
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
                  alt="First page of the PDF, with the watermark drawn over it"
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
                          // The preview renders at 96 dpi, so a point is 96/72 CSS pixels.
                          fontSize: fontSize * (96 / 72) * previewScale,
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
              <figcaption className="text-xs text-muted-foreground">
                Page 1, with the mark drawn over it in the browser. A close approximation — the font
                is your system's Helvetica, not the one written into the PDF.
              </figcaption>
            </figure>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Text marks use Helvetica, the font every PDF reader already has, so nothing is embedded
          and the file barely grows. Latin characters only: the built-in font cannot draw Vietnamese
          tone marks, CJK, Greek, Cyrillic or Arabic, and the tool will say so rather than fail
          obscurely.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy || (kind === 'image' && !markImage)}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Stamping…' : 'Add watermark'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm font-medium">
              Stamped {result.stamped} of {result.pages} {result.pages === 1 ? 'page' : 'pages'}
            </div>
            <a
              href={downloadUrl}
              download="watermarked.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download watermarked.pdf
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
