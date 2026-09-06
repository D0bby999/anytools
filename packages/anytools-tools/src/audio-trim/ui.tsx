'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, useLocalized } from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { type PcmBuffer, type TrimResult, trimToWav } from './logic';
import { STRINGS } from './strings';

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
const fmtSec = (n: number) => n.toFixed(2);

// Loaded once per module: two mounts of the tool on the same page (unlikely, but the SPA nav
// keeps the module alive) should not re-download the ~50 KB engine twice.
type WavesurferModule = typeof import('wavesurfer.js');
type RegionsModule = typeof import('wavesurfer.js/dist/plugins/regions.js');
let engineImport: Promise<[WavesurferModule, RegionsModule]> | null = null;
function loadEngine() {
  engineImport ??= Promise.all([
    import('wavesurfer.js'),
    import('wavesurfer.js/dist/plugins/regions.js'),
  ]);
  return engineImport;
}

export function AudioTrimUi() {
  const s = useLocalized(STRINGS);
  const objectUrls = useObjectUrls();
  const containerRef = useRef<HTMLDivElement>(null);
  // All four live for the lifetime of one loaded file; recreated by the effect below.
  const wsRef = useRef<import('wavesurfer.js').default | null>(null);
  const regionsRef = useRef<InstanceType<RegionsModule['default']> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'idle' | 'decoding' | 'ready' | 'error'>('idle');
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [result, setResult] = useState<TrimResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cutError, setCutError] = useState<string | null>(null);

  const file = files[0] ?? null;

  const stopPlayback = () => {
    sourceNodeRef.current?.stop();
    sourceNodeRef.current = null;
    setIsPlaying(false);
  };

  // objectUrls has a stable identity (useObjectUrls), safe to omit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    setResult(null);
    setUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
    setCutError(null);
    setSelection(null);
    setIsPlaying(false);

    if (!file || !containerRef.current) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('decoding');
    setDecodeError(null);
    trackEvent('tool_run', { tool: 'audio-trim' });

    (async () => {
      // Decode with the browser's own Web Audio API directly from the File's bytes — no
      // network layer involved at all, so this is unaffected by this site's `connect-src
      // 'self'` CSP (which has no `blob:` entry). wavesurfer's own `loadBlob` cannot be used
      // here: both of its playback backends ultimately do `fetch(objectURL)` or
      // `<audio>.src = objectURL` to get the bytes back, and Chrome enforces `connect-src`
      // against a `blob:` fetch just like any other one — confirmed via a
      // `securitypolicyviolation` event during phase-08 verification, not assumed. Below,
      // wavesurfer is used purely as a waveform-renderer + region-picker UI, fed the audio
      // this component already decoded itself (its own supported "peaks + duration, no url"
      // code path — see wavesurfer's WaveSurfer constructor).
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      if (cancelled || !containerRef.current) {
        await ctx.close().catch(() => undefined);
        return;
      }
      audioCtxRef.current = ctx;
      audioBufferRef.current = buffer;

      const [{ default: WaveSurfer }, { default: RegionsPlugin }] = await loadEngine();
      if (cancelled || !containerRef.current) return;
      const regions = RegionsPlugin.create();
      const channelData = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i),
      );
      const ws = WaveSurfer.create({
        container: containerRef.current,
        height: 96,
        waveColor: '#94a3b8',
        progressColor: '#6366f1',
        cursorColor: '#1e293b',
        peaks: channelData,
        duration: buffer.duration,
        interact: true,
        plugins: [regions],
      });
      wsRef.current = ws;
      regionsRef.current = regions;

      ws.on('ready', (duration) => {
        if (cancelled) return;
        const end = Math.min(duration, duration / 2 || duration);
        const region = regions.addRegion({
          start: 0,
          end,
          color: 'rgba(99, 102, 241, 0.2)',
          drag: true,
          resize: true,
        });
        setSelection({ start: region.start, end: region.end });
        setStatus('ready');
      });
      regions.on('region-update', (region) => {
        if (!cancelled) setSelection({ start: region.start, end: region.end });
      });
    })().catch((e) => {
      if (cancelled) return;
      setDecodeError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    });

    return () => {
      cancelled = true;
      sourceNodeRef.current?.stop();
      sourceNodeRef.current = null;
      wsRef.current?.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      audioBufferRef.current = null;
      audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
    };
  }, [file]);

  const playPause = () => {
    const region = regionsRef.current?.getRegions()[0];
    const ctx = audioCtxRef.current;
    const buffer = audioBufferRef.current;
    if (!region || !ctx || !buffer) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }
    ctx.resume().catch(() => undefined);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      sourceNodeRef.current = null;
      setIsPlaying(false);
    };
    source.start(0, region.start, Math.max(0, region.end - region.start));
    sourceNodeRef.current = source;
    setIsPlaying(true);
  };

  const cut = async () => {
    const region = regionsRef.current?.getRegions()[0];
    const buffer = audioBufferRef.current;
    if (!buffer || !region) return;
    setBusy(true);
    setCutError(null);
    try {
      // AudioBuffer already has every field PcmBuffer needs.
      const r = trimToWav(buffer as PcmBuffer, { startSec: region.start, endSec: region.end });
      setResult(r);
      setUrl(objectUrls.create(r.blob));
    } catch (e) {
      setCutError(toolErrorText(e, s, s.cutFailed));
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
          onChange={setFiles}
          accept="audio/*"
          multiple={false}
          label={s.fileLabel}
        />

        {status === 'decoding' && <p className="text-sm text-muted-foreground">{s.decoding}</p>}

        {status === 'error' && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {s.decodeFailed}
            {decodeError ? ` (${decodeError})` : ''}
          </output>
        )}

        {/* Always mounted so the effect above has a container ref before the file is picked;
            hidden until there is something to draw. */}
        <div
          ref={containerRef}
          className={status === 'ready' || status === 'decoding' ? 'block' : 'hidden'}
        />

        {status === 'ready' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{s.dragHint}</p>
            {selection && (
              <p className="text-sm text-muted-foreground">
                {s.selection
                  .replace('{start}', fmtSec(selection.start))
                  .replace('{end}', fmtSec(selection.end))
                  .replace('{dur}', fmtSec(selection.end - selection.start))}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={playPause}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                {isPlaying ? s.pause : s.play}
              </button>
              <button
                type="button"
                onClick={cut}
                disabled={!selection || busy}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {busy ? s.cutting : s.cut}
              </button>
            </div>

            {cutError && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {cutError}
              </output>
            )}

            {result && url && (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                <p className="text-sm text-muted-foreground">
                  {s.summary
                    .replace('{n}', 'PCM')
                    .replace('{in}', fmtSize(file?.size ?? 0))
                    .replace('{out}', fmtSize(result.outputBytes))}
                </p>
                <a
                  href={url}
                  download={`${(file?.name ?? 'clip').replace(/\.[^.]+$/, '')}-trim.wav`}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  {s.downloadWav}
                </a>
              </div>
            )}
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
