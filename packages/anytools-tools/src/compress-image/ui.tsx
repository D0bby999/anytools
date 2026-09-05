'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import type { OutputFormat } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type CompressResult, compressImage, compressToTargetSize } from './logic';
import { STRINGS } from './strings';

const FORMATS: OutputFormat[] = ['webp', 'jpeg', 'png'];
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export function CompressImageUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
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
      setError(toolErrorText(e, errorStrings, s.failed));
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
        <CardTitle className="text-xl">{s.title}</CardTitle>
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
          label={s.dropLabel}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.outputFormat}</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as OutputFormat)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                  {f === 'png' ? ` ${s.lossless}` : ''}
                </option>
              ))}
            </select>
          </label>

          {format !== 'png' &&
            (byTarget ? (
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">{s.targetSize}</span>
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
                  {s.quality.replace('{n}', String(Math.round(quality * 100)))}
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
            {s.sizeBudget}
          </label>
        )}

        {format === 'png' && <p className="text-sm text-muted-foreground">{s.pngNote}</p>}

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? s.compressing : s.compress}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {alphaLoss && (
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {s.alphaLoss}
          </output>
        )}

        {result?.targetMet === false && (
          // Without this the panel below reports the saving against the ORIGINAL, so a user
          // who asked for 500 KB and got 3 MB reads "40% smaller" next to a download button.
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {s.targetMissed
              .replace('{target}', String(targetKb))
              .replace('{actual}', (result.sizeAfter / 1024).toFixed(0))}
          </output>
        )}

        {result && url && srcUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              {result.width} × {result.height} px
              {result.scaledFrom
                ? ` ${s.decodedDown
                    .replace('{w}', String(result.scaledFrom.width))
                    .replace('{h}', String(result.scaledFrom.height))}`
                : ''}{' '}
              · {kb(result.sizeBefore)} → {kb(result.sizeAfter)} (
              {result.sizeAfter <= result.sizeBefore
                ? s.smaller.replace(
                    '{n}',
                    ((1 - result.sizeAfter / result.sizeBefore) * 100).toFixed(0),
                  )
                : s.larger.replace(
                    '{n}',
                    ((result.sizeAfter / result.sizeBefore - 1) * 100).toFixed(0),
                  )}
              )
            </div>
            {/* Before and after together: a percentage alone does not tell you whether the
                result still looks acceptable, which is the only question that matters. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <figure className="space-y-1">
                {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                <img src={srcUrl} alt={s.original} className="w-full rounded border" />
                <figcaption className="text-xs text-muted-foreground">
                  {s.originalSize.replace('{size}', kb(result.sizeBefore))}
                </figcaption>
              </figure>
              <figure className="space-y-1">
                {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
                <img src={url} alt={s.compressed} className="w-full rounded border" />
                <figcaption className="text-xs text-muted-foreground">
                  {s.compressedSize.replace('{size}', kb(result.sizeAfter))}
                </figcaption>
              </figure>
            </div>
            <a
              href={url}
              download={outName}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {s.download.replace('{name}', outName)}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
