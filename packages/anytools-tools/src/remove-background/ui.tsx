'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type RemoveBackgroundProgress,
  type RemoveBackgroundResult,
  removeBackground,
} from './logic';

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

  const file = files[0] ?? null;

  const run = async () => {
    if (!file) return;
    trackEvent('tool_run', { tool: 'remove-background' });
    setBusy(true);
    setError(null);
    setProgress({ stage: 'engine', loaded: 0, total: 0 });
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
      );
      setResult(r);
      setUrl((prev) => {
        if (prev) objectUrls.revoke(prev);
        return objectUrls.create(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Background removal failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const outName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}-no-background.png`
    : 'no-background.png';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Remove Image Background</CardTitle>
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
          label="Image (PNG, JPEG, WebP, AVIF, GIF)"
        />

        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          The first run downloads a 4.4 MB model and a 14 MB runtime and keeps both in your
          browser&rsquo;s cache — later runs, in this tab or after a reload, download nothing. The
          image itself is never uploaded.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              Cut-off: {threshold === 0 ? 'soft mask' : `${Math.round(threshold * 100)}%`}
            </span>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Edge softness: {feather} px</span>
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={feather}
              onChange={(e) => setFeather(Number(e.target.value))}
              className="w-full"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Background</span>
            <select
              value={background}
              onChange={(e) => setBackground(e.target.value as Background)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="transparent">Transparent</option>
              <option value="white">White</option>
              <option value="custom">Solid colour…</option>
            </select>
          </label>
        </div>

        {background === 'custom' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              className="h-9 w-16 rounded border border-input bg-background"
            />
            Fill the removed area with {colour}
          </label>
        )}

        <p className="text-sm text-muted-foreground">
          Cut-off 0 keeps the model&rsquo;s soft mask, which suits fur and motion blur; a higher
          cut-off gives a cleaner, harder edge. Edge softness blurs that edge afterwards.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Remove background'}
        </button>

        {progress && (
          <output className="block space-y-2 text-sm">
            <span className="block text-muted-foreground">
              {progress.stage === 'inference'
                ? 'Running the model on your image…'
                : progress.total > 0
                  ? `Downloading the ${progress.stage === 'engine' ? 'engine' : 'model'} — ${pct(progress)}%`
                  : 'Loading the engine and model (first run only)…'}
            </span>
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
              {result.width} × {result.height} px · kept {Math.round(result.opaque * 100)}% of the
              pixels, removed {Math.round(result.transparent * 100)}% · {result.inferenceMs} ms
            </div>
            <div className="rounded border p-2" style={CHECKERBOARD}>
              {/* A plain img, not next/image: this is a blob URL for bytes the browser already
                  holds, so there is nothing for the image optimiser to fetch or resize. No lint
                  suppression here on purpose — the rule category the sibling image tools name in
                  theirs does not exist in biome 1.9.4, so those files fail `biome check` parsing. */}
              <img src={url} alt="Cutout" className="mx-auto max-h-[28rem] w-auto" />
            </div>
            <a
              href={url}
              download={outName}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download {outName}
            </a>
            <p className="text-sm text-muted-foreground">
              The model is u2netp, a small open one from 2020. It is solid on a clear subject
              against a contrasting background, and weak on hair, fur, glass and backgrounds the
              same colour as the subject. If the mask is wrong, no slider here will fix it.
            </p>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
