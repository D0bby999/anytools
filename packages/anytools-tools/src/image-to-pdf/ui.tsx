'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
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

const PAGE_SIZE_OPTIONS: { value: PageSizeId; label: string }[] = [
  { value: 'a4', label: 'A4 — 210 × 297 mm' },
  { value: 'letter', label: 'US Letter — 8.5 × 11 in' },
  { value: 'fit', label: 'Fit the page to each image' },
];

const ORIENTATION_OPTIONS: { value: OrientationId; label: string }[] = [
  { value: 'auto', label: 'Match each image' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const MARGIN_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 18, label: 'Narrow — 6 mm' },
  { value: 36, label: 'Normal — 13 mm' },
  { value: 72, label: 'Wide — 25 mm' },
];

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ImageToPdfUi() {
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

  const reset = () => {
    setResult(null);
    setError(null);
    setDownloadUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return null;
    });
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
      setError(e instanceof Error ? e.message : 'Could not build the PDF');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Image to PDF</CardTitle>
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
          label="Images — drag to reorder, or use the arrows. One image per page, top to bottom."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Page size</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value as PageSizeId);
                reset();
              }}
              className={selectClass}
            >
              {PAGE_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Orientation</span>
            <select
              value={orientation}
              onChange={(e) => {
                setOrientation(e.target.value as OrientationId);
                reset();
              }}
              disabled={pageSize === 'fit'}
              className={`${selectClass} disabled:opacity-50`}
            >
              {ORIENTATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Margin</span>
            <select
              value={margin}
              onChange={(e) => {
                setMargin(Number(e.target.value));
                reset();
              }}
              className={selectClass}
            >
              {MARGIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
              Downscale to {PRINT_DPI} dpi at the printed size
              <span className="block text-xs text-muted-foreground">
                {pageSize === 'fit'
                  ? 'Not used when the page is sized to the image — shrinking would shrink the page.'
                  : 'Keeps a phone photo from adding several megabytes per page. Turn off to keep full resolution.'}
              </span>
            </span>
          </label>
        </div>

        <p className="text-sm text-muted-foreground">
          Every image is re-drawn in this tab before it goes into the PDF. That is what applies the
          rotation flag a phone camera writes, and what lets WebP and GIF in at all — PDF itself
          stores only JPEG and PNG.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? `Reading image ${progress.done + 1} of ${progress.total}…`
              : 'Building PDF…'
            : `Create PDF from ${files.length || ''} image${files.length === 1 ? '' : 's'}`}
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
                {result.pages} {result.pages === 1 ? 'page' : 'pages'}
              </div>
              <ul className="mt-1 text-muted-foreground">
                {result.sources.map((s, i) => (
                  <li key={`${i}-${s.name}`}>
                    {s.name} — {s.pixels} px on a {s.page} page
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={downloadUrl}
              download="images.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download images.pdf
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
