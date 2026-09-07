'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  ColorInput,
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
} from '@anytools/ui';
import { useMemo, useRef, useState } from 'react';
import { isAbortError } from '../shared/onnx-loader';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type RemoveBackgroundProgress,
  type RemoveBackgroundResult,
  removeBackground,
} from './logic';
import { STRINGS } from './strings';

/** A transparent PNG on a white page looks like a white PNG. The checkerboard is the proof. */
const CHECKERBOARD = {
  backgroundImage:
    'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
  backgroundColor: '#ffffff',
};

type Background = 'transparent' | 'white' | 'custom';

const pct = (p: RemoveBackgroundProgress) =>
  p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;

export function RemoveBackgroundUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  // Errors from the shared modules (canvas ceiling, page ranges, pdf.js…) under the tool's own keys.
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [threshold, setThreshold] = useState(0.5);
  const [feather, setFeather] = useState(1);
  const [background, setBackground] = useState<Background>('transparent');
  const [colour, setColour] = useState('#ffffff');
  const [progress, setProgress] = useState<RemoveBackgroundProgress | null>(null);
  const [result, setResult] = useState<RemoveBackgroundResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cancels the two one-off downloads. Not the inference: that is one synchronous call into
  // WebAssembly on the main thread, and nothing — not this signal, not the browser — interrupts it.
  const abort = useRef<AbortController | null>(null);

  const file = files[0] ?? null;

  /** Drop the current result and free the blob behind its object URL. */
  const clearResult = () => {
    objectUrls.revoke(url);
    setUrl(null);
    setResult(null);
  };

  const run = async () => {
    if (!file) return;
    trackEvent('tool_run', { tool: 'remove-background' });
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    setProgress({ stage: 'engine', loaded: 0, total: 0 });
    // Revoked before the run, not inside the state updater that replaces it: React may call an
    // updater more than once, and a revoke that runs twice is a leak (the second create is never
    // released) as surely as one that never runs.
    objectUrls.revoke(url);
    setUrl(null);
    try {
      const r = await removeBackground(
        file,
        {
          threshold,
          feather,
          background:
            background === 'transparent' ? null : background === 'white' ? '#ffffff' : colour,
        },
        setProgress,
        controller.signal,
      );
      setResult(r);
      setUrl(objectUrls.create(r.blob));
    } catch (e) {
      setResult(null);
      if (isAbortError(e)) setError(s.cancelled);
      else setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      abort.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const outName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}-no-background.png`
    : 'no-background.png';

  const progressLabel = (p: RemoveBackgroundProgress) =>
    p.stage === 'inference'
      ? s.runningModel
      : p.total > 0
        ? (p.stage === 'engine' ? s.downloadingEngine : s.downloadingModel).replace(
            '{pct}',
            String(pct(p)),
          )
        : s.loadingFirstRun;

  return (
    <FilePipelineTemplate
      title={s.title}
      dropzone={
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            clearResult();
            setError(null);
          }}
          accept="image/*"
          multiple={false}
          label={s.dropLabel}
        />
      }
      result={
        <>
          <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
            {s.firstRunNote}
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <RangeSlider
                label={s.cutoffLabel}
                unit="%"
                value={Math.round(threshold * 100)}
                min={0}
                max={90}
                step={5}
                onChange={(v) => setThreshold(v / 100)}
              />
              {/* 0 is not "0% cut-off", it means the soft mask is used as-is — worth saying,
                since a slider at its minimum otherwise reads as "off". */}
              {threshold === 0 && <p className="text-xs text-muted-foreground">{s.softMask}</p>}
            </div>

            <RangeSlider
              label={s.edgeSoftnessLabel}
              unit="px"
              value={feather}
              min={0}
              max={8}
              onChange={setFeather}
            />

            <div className="space-y-1.5">
              <Label htmlFor="rbg-background">{s.background}</Label>
              <Select value={background} onValueChange={(v) => setBackground(v as Background)}>
                <SelectTrigger id="rbg-background">
                  <SelectValue>
                    {background === 'white'
                      ? s.bg_white
                      : background === 'custom'
                        ? s.bg_custom
                        : s.bg_transparent}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transparent">{s.bg_transparent}</SelectItem>
                  <SelectItem value="white">{s.bg_white}</SelectItem>
                  <SelectItem value="custom">{s.bg_custom}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {background === 'custom' && (
            <ColorInput label={s.bg_custom} value={colour} onChange={setColour} />
          )}

          <p className="text-sm text-muted-foreground">{s.cutoffNote}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={run} disabled={!file || busy}>
              {busy ? s.working : s.removeBackground}
            </Button>

            {/* Only offered while bytes are moving. Once inference starts there is nothing left to
              cancel — the WASM call blocks this thread until it returns — and a dead button is
              worse than none. */}
            {busy && progress && progress.stage !== 'inference' && (
              <Button variant="outline" type="button" onClick={() => abort.current?.abort()}>
                {s.cancelDownload}
              </Button>
            )}
          </div>

          {progress && (
            <output className="block space-y-2 text-sm">
              <span className="block text-muted-foreground">{progressLabel(progress)}</span>
              <span className="block h-2 w-full overflow-hidden rounded bg-muted">
                <span
                  className="block h-full bg-primary transition-[width]"
                  style={{ width: progress.stage === 'inference' ? '100%' : `${pct(progress)}%` }}
                />
              </span>
            </output>
          )}

          {error && (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </output>
          )}

          {result && url && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted p-3 text-sm">
                {s.resultLine
                  .replace('{w}', String(result.width))
                  .replace('{h}', String(result.height))
                  .replace('{kept}', String(Math.round(result.opaque * 100)))
                  .replace('{removed}', String(Math.round(result.transparent * 100)))
                  .replace('{ms}', String(result.inferenceMs))}
                {result.scaledFrom && (
                  <span className="mt-1 block text-muted-foreground">
                    {s.scaledNote
                      .replace('{w}', String(result.scaledFrom.width))
                      .replace('{h}', String(result.scaledFrom.height))}
                  </span>
                )}
              </div>
              <div className="rounded border p-2" style={CHECKERBOARD}>
                {/* A plain img, not next/image: this is a blob URL for bytes the browser already
                  holds, so there is nothing for the image optimiser to fetch or resize. No lint
                  suppression here on purpose — the rule category the sibling image tools name in
                  theirs does not exist in biome 1.9.4, so those files fail `biome check` parsing. */}
                <img src={url} alt={s.cutoutAlt} className="mx-auto max-h-[28rem] w-auto" />
              </div>
              <Button asChild>
                <a href={url} download={outName}>
                  {s.download.replace('{name}', outName)}
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">{s.modelNote}</p>
            </div>
          )}
        </>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
