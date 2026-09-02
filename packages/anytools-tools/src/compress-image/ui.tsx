'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import type { OutputFormat } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import { type CompressResult, compressImage, compressToTargetSize } from './logic';

const FORMATS: OutputFormat[] = ['webp', 'jpeg', 'png'];
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export function CompressImageUi() {
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<OutputFormat>('webp');
  const [quality, setQuality] = useState(0.8);
  const [byTarget, setByTarget] = useState(false);
  const [targetKb, setTargetKb] = useState(500);
  const [result, setResult] = useState<CompressResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  useEffect(() => {
    setSrcUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return file ? objectUrls.create(file) : null;
    });
  }, [file]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // PNG is lossless, so quality is ignored and every search iteration produces a
      // byte-identical file. Running the budget search there is 9 full-resolution encodes to
      // reach the same answer the first one gave.
      const useTarget = byTarget && format !== 'png';
      const r = useTarget
        ? await compressToTargetSize(file, format, targetKb * 1024)
        : await compressImage(file, { format, quality });
      setResult(r);
      setUrl((prev) => {
        if (prev) objectUrls.revoke(prev);
        return objectUrls.create(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Compression failed');
    } finally {
      setBusy(false);
    }
  };

  const outName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}-compressed.${format === 'jpeg' ? 'jpg' : format}`
    : 'image';
  const alphaLoss = result?.sourceHasAlpha && result.format === 'jpeg';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Compress Image</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
          }}
          accept="image/*"
          multiple={false}
          label="Image to compress (PNG, JPEG, WebP, AVIF, GIF)"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Output format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as OutputFormat)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                  {f === 'png' ? ' (lossless)' : ''}
                </option>
              ))}
            </select>
          </label>

          {format !== 'png' &&
            (byTarget ? (
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Target size (KB)</span>
                <input
                  type="number"
                  min={10}
                  value={targetKb}
                  onChange={(e) => setTargetKb(Number(e.target.value))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </label>
            ) : (
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Quality: {Math.round(quality * 100)}%
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
            ))}
        </div>

        {format !== 'png' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={byTarget}
              onChange={(e) => setByTarget(e.target.checked)}
            />
            Hit a size budget instead — finds the best quality that fits
          </label>
        )}

        {format === 'png' && (
          <p className="text-sm text-muted-foreground">
            PNG is lossless, so there is no quality setting. For photographs WebP will be far
            smaller at the same visual quality.
          </p>
        )}

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Compressing…' : 'Compress'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {alphaLoss && (
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            This image has transparent areas and JPEG cannot store them — they have been filled in.
            Choose WebP or PNG to keep the transparency.
          </output>
        )}

        {result?.targetMet === false && (
          // Without this the panel below reports the saving against the ORIGINAL, so a user
          // who asked for 500 KB and got 3 MB reads "40% smaller" next to a download button.
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Could not reach {targetKb} KB even at the lowest quality — the result below is{' '}
            {(result.sizeAfter / 1024).toFixed(0)} KB. Reduce the dimensions with Resize Image
            first; past a point, quality alone cannot get there.
          </output>
        )}

        {result && url && srcUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              {result.width} × {result.height} px · {kb(result.sizeBefore)} → {kb(result.sizeAfter)}{' '}
              (
              {result.sizeAfter <= result.sizeBefore
                ? `${((1 - result.sizeAfter / result.sizeBefore) * 100).toFixed(0)}% smaller`
                : `${((result.sizeAfter / result.sizeBefore - 1) * 100).toFixed(0)}% larger`}
              )
            </div>
            {/* Before and after together: a percentage alone does not tell you whether the
                result still looks acceptable, which is the only question that matters. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <figure className="space-y-1">
                {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                <img src={srcUrl} alt="Original" className="w-full rounded border" />
                <figcaption className="text-xs text-muted-foreground">
                  Original — {kb(result.sizeBefore)}
                </figcaption>
              </figure>
              <figure className="space-y-1">
                {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                <img src={url} alt="Compressed" className="w-full rounded border" />
                <figcaption className="text-xs text-muted-foreground">
                  Compressed — {kb(result.sizeAfter)}
                </figcaption>
              </figure>
            </div>
            <a
              href={url}
              download={outName}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download {outName}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
