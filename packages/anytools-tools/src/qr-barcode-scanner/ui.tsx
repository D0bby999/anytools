'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { type DecodedSymbol, decodeBarcodeImage, decodeImageData } from './logic';
import { STRINGS } from './strings';

const ACCEPT = 'image/*';
/** How often a camera frame is handed to the decoder. Every frame is wasted work. */
const CAMERA_INTERVAL_MS = 150;

type CameraState = 'off' | 'starting' | 'live';

export function QrBarcodeScannerUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [files, setFiles] = useState<File[]>([]);
  const [symbols, setSymbols] = useState<DecodedSymbol[] | null>(null);
  const [source, setSource] = useState<'image' | 'camera' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<CameraState>('off');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameHandle = useRef<number | null>(null);
  const timerHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped by every start and every stop. A getUserMedia call that resolves after the user has
  // already pressed Stop (or Start again) is stale: without this its stream was assigned over the
  // live one and never stopped — indicator light on until the tab closed (review, 2026-09-03).
  const cameraGen = useRef(0);

  // The footnote carries two inline links; split the sentence around their placeholders.
  const [noteBefore, noteRest = ''] = s.makeCodeNote.split('{barcode}');
  const [noteMiddle, noteAfter = ''] = noteRest.split('{qr}');

  /**
   * Release the camera.
   *
   * Stopping every track is what turns the indicator light off. Doing it in one place, called
   * from the button, from a successful read and from the unmount effect, is the only way this
   * stays true — a page left with a live stream keeps the light on until the tab is closed,
   * which is the classic defect in browser scanners.
   */
  const stopCamera = useCallback(() => {
    cameraGen.current += 1;
    if (frameHandle.current !== null) {
      const video = videoRef.current as
        | (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void })
        | null;
      video?.cancelVideoFrameCallback?.(frameHandle.current);
      frameHandle.current = null;
    }
    if (timerHandle.current !== null) {
      clearInterval(timerHandle.current);
      timerHandle.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera('off');
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const scanFile = async (file: File) => {
    trackEvent('tool_run', { tool: 'qr-barcode-scanner' });
    stopCamera();
    setBusy(true);
    setError(null);
    setSymbols(null);
    try {
      const found = await decodeBarcodeImage(file);
      setSymbols(found);
      setSource('image');
    } catch (e) {
      setError(e instanceof Error ? e.message : s.failed);
    } finally {
      setBusy(false);
    }
  };

  /** Grab one frame, decode it, and stop the camera as soon as anything is found. */
  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    try {
      const found = await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (found.length > 0) {
        setSymbols(found);
        setSource('camera');
        stopCamera();
      }
    } catch {
      // A frame that fails to decode is the normal case while the user aims. Only a failure to
      // start the camera is worth telling anyone about.
    }
  }, [stopCamera]);

  const startCamera = async () => {
    trackEvent('tool_run', { tool: 'qr-barcode-scanner' });
    setError(null);
    setSymbols(null);
    setCamera('starting');
    const gen = ++cameraGen.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // 720p is plenty for a code that fills a fraction of the frame; without a size hint a 4K
        // webcam hands over 8 MP per frame, decoded synchronously on the main thread.
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      if (gen !== cameraGen.current) return;
      setCamera('off');
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? s.cameraDenied
          : name === 'NotFoundError'
            ? s.cameraNotFound
            : s.cameraFailed,
      );
      return;
    }
    if (gen !== cameraGen.current || streamRef.current) {
      // Stale: the user pressed Stop (or Start again) while the permission prompt was up.
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stopCamera();
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    setCamera('live');

    // requestVideoFrameCallback fires once per decoded frame, which is the efficient hook; it
    // is missing on older Safari, where a plain interval is the fallback. Either way the
    // decoder runs at most every CAMERA_INTERVAL_MS — scanning every frame just heats the phone.
    const withRvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (typeof withRvfc.requestVideoFrameCallback === 'function') {
      let last = 0;
      const onFrame = (now: number) => {
        if (now - last >= CAMERA_INTERVAL_MS) {
          last = now;
          void scanFrame();
        }
        if (streamRef.current) {
          frameHandle.current = withRvfc.requestVideoFrameCallback?.(onFrame) ?? null;
        }
      };
      frameHandle.current = withRvfc.requestVideoFrameCallback(onFrame);
    } else {
      timerHandle.current = setInterval(() => void scanFrame(), CAMERA_INTERVAL_MS);
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
          onChange={(f) => {
            setFiles(f);
            const file = f[0];
            if (file) void scanFile(file);
          }}
          accept={ACCEPT}
          multiple={false}
          label={s.dropLabel}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (camera === 'off' ? void startCamera() : stopCamera())}
            className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >
            {camera === 'off' ? s.scanWithCamera : s.stopCamera}
          </button>
          {files[0] && (
            <button
              type="button"
              onClick={() => {
                const file = files[0];
                if (file) void scanFile(file);
              }}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? s.scanning : s.scanAgain}
            </button>
          )}
          <span className="text-xs text-muted-foreground">{s.cameraNote}</span>
        </div>

        {/* Kept mounted so the ref exists before getUserMedia resolves; hidden while off.
            No <track>: a live camera preview has no captions to offer, and it carries no
            information — every result is rendered as text below. */}
        <video
          ref={videoRef}
          muted
          playsInline
          className={
            camera === 'off'
              ? 'hidden'
              : 'w-full max-w-md rounded-md border bg-black object-contain'
          }
        />
        {camera === 'starting' && (
          <p className="text-sm text-muted-foreground">{s.startingCamera}</p>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {symbols?.length === 0 && (
          <output className="block rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {s.noBarcode}
          </output>
        )}

        {symbols && symbols.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {(symbols.length === 1 ? s.readOne : s.readMany)
                .replace('{n}', String(symbols.length))
                .replace('{source}', source === 'camera' ? s.sourceCamera : s.sourceImage)}
            </p>
            <ul className="space-y-3">
              {symbols.map((sym, i) => (
                <li
                  key={`${sym.format}-${sym.center.x}-${sym.center.y}-${i}`}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                      {sym.format}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.at
                        .replace('{x}', String(sym.center.x))
                        .replace('{y}', String(sym.center.y))}
                    </span>
                    <CopyButton text={sym.text} className="ml-auto" />
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                    {sym.text}
                  </pre>
                  {sym.payload.kind === 'url' && (
                    <p className="text-xs">
                      {s.webAddress}{' '}
                      {/* Never opened automatically, and never anything but http(s): a code
                          printed by a stranger must not be able to navigate this page. */}
                      <a
                        href={sym.payload.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="underline"
                      >
                        {s.openNewTab}
                      </a>
                      {s.checkFirst}
                    </p>
                  )}
                  {sym.payload.kind === 'wifi' && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">{s.network}</dt>
                      <dd className="font-mono">{sym.payload.wifi.ssid}</dd>
                      <dt className="text-muted-foreground">{s.password}</dt>
                      <dd className="font-mono">
                        {sym.payload.wifi.password || <span className="italic">{s.none}</span>}
                      </dd>
                      <dt className="text-muted-foreground">{s.security}</dt>
                      <dd className="font-mono">{sym.payload.wifi.encryption}</dd>
                      {sym.payload.wifi.hidden && (
                        <>
                          <dt className="text-muted-foreground">{s.hidden}</dt>
                          <dd>{s.yes}</dd>
                        </>
                      )}
                    </dl>
                  )}
                  {sym.payload.kind === 'vcard' && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {Object.entries(sym.payload.vcard).map(([k, v]) => (
                        <span key={k} className="contents">
                          <dt className="text-muted-foreground capitalize">{k}</dt>
                          <dd className="font-mono">{v}</dd>
                        </span>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {noteBefore}
          <a href={`/${locale}/generators/barcode-generator`} className="underline">
            {s.barcodeGenerator}
          </a>
          {noteMiddle}
          <a href={`/${locale}/generators/qr-code-generator`} className="underline">
            {s.qrGenerator}
          </a>
          {noteAfter}
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
