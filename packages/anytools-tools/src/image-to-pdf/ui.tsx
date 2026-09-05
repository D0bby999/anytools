'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type ImageToPdfResult,
  type OrientationId,
  PRINT_DPI,
  type PageSizeId,
  imagesToPdf,
  prepareImages,
} from './logic';
import { STRINGS } from './strings';

const PAGE_SIZES: PageSizeId[] = ['a4', 'letter', 'fit'];
const ORIENTATIONS: OrientationId[] = ['auto', 'portrait', 'landscape'];
const MARGINS = [0, 18, 36, 72] as const;

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ImageToPdfUi() {
  const s = useLocalized(STRINGS);
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeId>('a4');
  const [orientation, setOrientation] = useState<OrientationId>('auto');
  const [margin, setMargin] = useState(36);
  const [downscale, setDownscale] = useState(true);
  const [result, setResult] = useState<ImageToPdfResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Paper names and dimensions are the same in every locale; only the "fit" option is prose.
  const pageSizeLabel: Record<PageSizeId, string> = {
    a4: 'A4 — 210 × 297 mm',
    letter: 'US Letter — 8.5 × 11 in',
    fit: s.size_fit,
  };
  const orientationLabel: Record<OrientationId, string> = {
    auto: s.orient_auto,
    portrait: s.orient_portrait,
    landscape: s.orient_landscape,
  };
  const marginLabel: Record<(typeof MARGINS)[number], string> = {
    0: s.margin_none,
    18: s.margin_narrow,
    36: s.margin_normal,
    72: s.margin_wide,
  };

  // Revoke outside the updater: React may run an updater more than once (and does, in
  // StrictMode), which would revoke a URL still on screen and leak the extra ones.
  const reset = () => {
    objectUrls.revoke(downloadUrl);
    setDownloadUrl(null);
    setResult(null);
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    reset();
    trackEvent('tool_run', { tool: 'image-to-pdf' });
    const opts = { pageSize, orientation, margin, downscale };
    try {
      // Two phases: decode on the canvas (slow, one image at a time), then assemble. The
      // progress readout covers the first because that is where the seconds go.
      setProgress({ done: 0, total: files.length });
      const images = await prepareImages(files, opts, (done, total) =>
        setProgress({ done, total }),
      );
      setProgress(null);
      const r = await imagesToPdf(images, opts);
      setResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : s.failed);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const createLabel =
    files.length === 0
      ? s.createEmpty
      : files.length === 1
        ? s.createOne
        : s.createMany.replace('{n}', String(files.length));

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
          accept="image/*"
          reorderable
          label={s.dropLabel}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">{s.pageSize}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value as PageSizeId);
                reset();
              }}
              className={selectClass}
            >
              {PAGE_SIZES.map((id) => (
                <option key={id} value={id}>
                  {pageSizeLabel[id]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">{s.orientation}</span>
            <select
              value={orientation}
              onChange={(e) => {
                setOrientation(e.target.value as OrientationId);
                reset();
              }}
              disabled={pageSize === 'fit'}
              className={`${selectClass} disabled:opacity-50`}
            >
              {ORIENTATIONS.map((id) => (
                <option key={id} value={id}>
                  {orientationLabel[id]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">{s.margin}</span>
            <select
              value={margin}
              onChange={(e) => {
                setMargin(Number(e.target.value));
                reset();
              }}
              className={selectClass}
            >
              {MARGINS.map((m) => (
                <option key={m} value={m}>
                  {marginLabel[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={downscale && pageSize !== 'fit'}
              disabled={pageSize === 'fit'}
              onChange={(e) => {
                setDownscale(e.target.checked);
                reset();
              }}
              className="mt-0.5 h-4 w-4"
            />
            <span className={pageSize === 'fit' ? 'text-muted-foreground' : ''}>
              {s.downscale.replace('{dpi}', String(PRINT_DPI))}
              <span className="block text-xs text-muted-foreground">
                {pageSize === 'fit' ? s.downscaleFitNote : s.downscaleNote}
              </span>
            </span>
          </label>
        </div>

        <p className="text-sm text-muted-foreground">{s.redrawNote}</p>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? s.readingImage
                  .replace('{n}', String(progress.done + 1))
                  .replace('{total}', String(progress.total))
              : s.building
            : createLabel}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div className="font-medium">
                {(result.pages === 1 ? s.pageCountOne : s.pageCountMany).replace(
                  '{n}',
                  String(result.pages),
                )}
              </div>
              <ul className="mt-1 text-muted-foreground">
                {result.sources.map((src, i) => (
                  <li key={`${i}-${src.name}`}>
                    {s.sourceLine
                      .replace('{name}', src.name)
                      .replace('{pixels}', src.pixels)
                      .replace('{page}', src.page)}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={downloadUrl}
              download="images.pdf"
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
