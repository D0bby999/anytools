'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  HEIC_EXTENSIONS,
  type HeicConversion,
  type HeicFailure,
  type HeicFormat,
  convertHeicFiles,
  zipConversions,
} from './logic';

const SLUG = 'heic-to-jpg';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function HeicToJpgUi() {
  // Revokes every preview and download URL when the component unmounts.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<HeicFormat>('jpeg');
  const [quality, setQuality] = useState(0.9);
  const [results, setResults] = useState<HeicConversion[]>([]);
  // Created once per batch, not in render: `createObjectURL` in JSX mints a new URL on every
  // re-render — every slider nudge would strand another full-size image in memory.
  const [previews, setPreviews] = useState<string[]>([]);
  const [failures, setFailures] = useState<HeicFailure[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    objectUrls.revokeAll();
    setResults([]);
    setPreviews([]);
    setFailures([]);
    setError(null);
    setProgress(null);
  };

  const run = async () => {
    if (files.length === 0) return;
    reset();
    setBusy(true);
    trackEvent('tool_run', { tool: SLUG });
    try {
      const outcome = await convertHeicFiles(files, { format, quality }, (done, total) =>
        setProgress({ done, total }),
      );
      setResults(outcome.results);
      setPreviews(outcome.results.map((r) => objectUrls.create(r.blob)));
      setFailures(outcome.failures);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = objectUrls.create(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking in the same tick cancels the download the click just started.
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const downloadAll = async () => {
    setError(null);
    try {
      saveBlob(
        await zipConversions(results),
        `heic-converted-${format === 'jpeg' ? 'jpg' : 'png'}.zip`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the zip');
    }
  };

  const burst = results.filter((r) => r.imageCount > 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">HEIC to JPG</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept={`${HEIC_EXTENSIONS.join(',')},image/heic,image/heif`}
          multiple
          label="HEIC or HEIF photos (.heic, .heif, .hif)"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Save as</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as HeicFormat)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="jpeg">JPG — opens everywhere</option>
              <option value="png">PNG — lossless, much larger</option>
            </select>
          </label>

          {format === 'jpeg' && (
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                JPEG quality: {Math.round(quality * 100)}%
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}
        </div>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? `Converting ${progress.done}/${progress.total}…`
              : 'Converting…'
            : `Convert ${files.length > 1 ? `${files.length} photos` : 'photo'}`}
        </button>

        <p className="text-sm text-muted-foreground">
          The HEIC decoder is about 1 MB and is fetched from this site the first time you convert
          something — not when the page loads. Everything after that happens on this page.
        </p>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {failures.length > 0 && (
          <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {failures.map((f) => (
              <p key={f.name}>{f.message}</p>
            ))}
          </output>
        )}

        {burst.length > 0 && (
          <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
            {burst.length === 1 ? 'One file holds' : `${burst.length} files hold`} more than one
            image — a Live Photo or a burst. The still frame the camera marked as the main one was
            converted; the other frames and the video are left in the original file.
          </output>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            {results.length > 1 && (
              <button
                type="button"
                onClick={downloadAll}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                Download all {results.length} as .zip
              </button>
            )}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {results.map((r, i) => (
                <li key={r.sourceName} className="space-y-1 rounded-md border p-2">
                  {/* A plain <img>: the source is a blob URL in this tab, which next/image cannot
                      optimise and must not try to fetch. */}
                  <img src={previews[i]} alt={r.name} className="w-full rounded border" />
                  <p className="truncate text-sm">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.width} × {r.height} px · {kb(r.sourceSize)} → {kb(r.blob.size)}
                  </p>
                  <button
                    type="button"
                    onClick={() => saveBlob(r.blob, r.name)}
                    className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
