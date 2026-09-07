'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  FilePipelineTemplate,
  Label,
  MultiFileDropzone,
  PrivacyNote,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { SHARED_ERROR_STRINGS, returnedErrorText } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  HEIC_EXTENSIONS,
  type HeicConversion,
  type HeicFailure,
  type HeicFormat,
  convertHeicFiles,
  zipConversions,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'heic-to-jpg';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function HeicToJpgUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const ui = useUiStrings();
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
      setError(toolErrorText(e, errorStrings, ui.conversionFailed));
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
      setError(toolErrorText(e, errorStrings, s.zipFailed));
    }
  };

  const burst = results.filter((r) => r.imageCount > 1);
  // A photo above the canvas ceiling is written smaller rather than refused, so say so: the
  // download is not the size the camera took, and nothing else on the page would reveal that.
  const scaled = results.filter((r) => r.width !== r.sourceWidth || r.height !== r.sourceHeight);

  const convertLabel =
    files.length > 1 ? s.convertMany.replace('{n}', String(files.length)) : s.convertOne;

  return (
    <FilePipelineTemplate
      title={s.title}
      dropzone={
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          // AVIF is in the list so that dropping one produces the explanation in `logic.ts`
          // rather than nothing at all: the dropzone discards anything outside `accept`
          // silently, and "my file vanished" is a worse answer than "AVIF is not supported
          // here". Nothing is decoded — the brand check turns it away before the WASM loads.
          accept={`${HEIC_EXTENSIONS.join(',')},.avif,image/heic,image/heif,image/avif`}
          multiple
          label={s.dropLabel}
        />
      }
      result={
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="heic-format">{s.saveAs}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as HeicFormat)}>
                <SelectTrigger id="heic-format">
                  <SelectValue>{format === 'png' ? s.pngOption : s.jpgOption}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jpeg">{s.jpgOption}</SelectItem>
                  <SelectItem value="png">{s.pngOption}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {format === 'jpeg' && (
              <RangeSlider
                label={s.qualityLabel}
                unit="%"
                value={Math.round(quality * 100)}
                min={10}
                max={100}
                step={5}
                onChange={(v) => setQuality(v / 100)}
              />
            )}
          </div>

          <Button type="button" onClick={run} disabled={files.length === 0 || busy}>
            {busy
              ? progress
                ? s.convertingProgress
                    .replace('{done}', String(progress.done))
                    .replace('{total}', String(progress.total))
                : s.converting
              : convertLabel}
          </Button>

          <p className="text-sm text-muted-foreground">{s.decoderNote}</p>

          {error && (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </output>
          )}

          {failures.length > 0 && (
            <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              {failures.map((f) => (
                <p key={f.name}>{returnedErrorText(errorStrings, f.code, f.params, f.message)}</p>
              ))}
            </output>
          )}

          {burst.length > 0 && (
            <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
              {burst.length === 1 ? s.burstOne : s.burstMany.replace('{n}', String(burst.length))}
            </output>
          )}

          {scaled.length > 0 && (
            <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
              {(scaled.length === 1 ? s.scaledOne : s.scaledMany)
                .replace('{n}', String(scaled.length))
                .replace('{sw}', String(scaled[0]?.sourceWidth))
                .replace('{sh}', String(scaled[0]?.sourceHeight))
                .replace('{w}', String(scaled[0]?.width))
                .replace('{h}', String(scaled[0]?.height))}
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
                  {s.downloadAllZip.replace('{n}', String(results.length))}
                </button>
              )}
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {results.map((r, i) => (
                  // Output names are made unique per batch, so two IMG_0001.HEIC are two keys.
                  <li key={r.name} className="space-y-1 rounded-md border p-2">
                    {/* A plain <img>: the source is a blob URL in this tab, which next/image cannot
                      optimise and must not try to fetch. */}
                    <img src={previews[i]} alt={r.name} className="w-full rounded border" />
                    <p className="truncate text-sm">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.width} × {r.height} px
                      {(r.width !== r.sourceWidth || r.height !== r.sourceHeight) &&
                        ` ${s.scaledFrom
                          .replace('{w}', String(r.sourceWidth))
                          .replace('{h}', String(r.sourceHeight))}`}{' '}
                      · {kb(r.sourceSize)} → {kb(r.blob.size)}
                    </p>
                    <Button type="button" size="sm" onClick={() => saveBlob(r.blob, r.name)}>
                      {ui.download}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
