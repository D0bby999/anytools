'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  SegmentedControl,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { fitWithin, loadBitmap } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import { ImageCompareSlider } from './image-compare-slider';
import { CVD_TYPES, type CvdType, hexToRgb, rgbToHex, simulate, simulateImageData } from './logic';
import { STRINGS } from './strings';

const SLUG = 'color-blindness-simulator';
type Mode = 'image' | 'color';
const PREVIEW_MAX = 640;

export function ColorBlindnessSimulatorUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const objectUrls = useObjectUrls();

  const [mode, setMode] = useState<Mode>('image');
  const [cvdType, setCvdType] = useState<CvdType>('protanopia');
  const [files, setFiles] = useState<File[]>([]);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [simulatedUrl, setSimulatedUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [splitPercent, setSplitPercent] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorText, setColorText] = useState('#e67e22');

  const file = files[0] ?? null;
  const trackedRun = () => trackEvent('tool_run', { tool: SLUG });

  // Original preview URL — separate from the simulated one so a slow re-simulate (changing the
  // deficiency) never has to touch the file input's own object URL.
  useEffect(() => {
    setSrcUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return file ? objectUrls.create(file) : null;
    });
  }, [file, objectUrls]);

  // Decode once per file, draw at a capped preview size, run the per-pixel simulation, and hand
  // back a PNG blob URL. Re-runs whenever the file or the chosen deficiency changes.
  useEffect(() => {
    if (!file) {
      setSimulatedUrl(null);
      setDimensions(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const bitmap = await loadBitmap(file);
        const { width, height } = fitWithin(bitmap.width, bitmap.height, PREVIEW_MAX, PREVIEW_MAX);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('no-2d-context');
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const imageData = ctx.getImageData(0, 0, width, height);
        simulateImageData(imageData.data, cvdType);
        ctx.putImageData(imageData, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (cancelled) return;
        if (!blob) throw new Error('encode-failed');
        setSimulatedUrl((prev) => {
          if (prev) objectUrls.revoke(prev);
          return objectUrls.create(blob);
        });
        setDimensions({ width, height });
        trackEvent('tool_run', { tool: SLUG });
      } catch (e) {
        if (!cancelled) setError(toolErrorText(e, errorStrings, s.loading));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, cvdType, objectUrls, errorStrings, s.loading]);

  const colorRgb = hexToRgb(colorText);
  const colorSwatches = colorRgb
    ? CVD_TYPES.map((type) => ({ type, rgb: simulate(colorRgb, type) }))
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: 'image', label: s.modeImage },
            { value: 'color', label: s.modeColor },
          ]}
        />

        <SegmentedControl
          label={s.deficiency}
          value={cvdType}
          onChange={setCvdType}
          options={CVD_TYPES.map((type) => ({ value: type, label: s[`type_${type}`] }))}
        />

        {mode === 'image' ? (
          <div className="space-y-3">
            <MultiFileDropzone
              files={files}
              onChange={(f) => {
                setFiles(f);
                setError(null);
              }}
              accept="image/*"
              multiple={false}
              label={s.uploadLabel}
            />
            {error && (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </output>
            )}
            {busy && !error && <p className="text-sm text-muted-foreground">{s.loading}</p>}
            {srcUrl && simulatedUrl && dimensions && !error && (
              <ImageCompareSlider
                originalUrl={srcUrl}
                simulatedUrl={simulatedUrl}
                splitPercent={splitPercent}
                onSplitChange={setSplitPercent}
                aspectRatio={dimensions.width / dimensions.height}
              />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{s.colorLabel}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colorRgb ? rgbToHex(colorRgb) : '#000000'}
                  onChange={(e) => setColorText(e.target.value)}
                  className="h-11 w-11 cursor-pointer rounded border"
                  aria-label={s.colorLabel}
                />
                <Input
                  value={colorText}
                  onChange={(e) => setColorText(e.target.value)}
                  placeholder={s.colorPlaceholder}
                  className="h-11 max-w-[10rem] font-mono"
                />
              </div>
            </label>
            {!colorRgb ? (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {s.error_invalidColor}
              </output>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <ColorSwatch label={s.original} hex={rgbToHex(colorRgb)} onCopy={trackedRun} />
                {colorSwatches.map(({ type, rgb }) => (
                  <ColorSwatch
                    key={type}
                    label={s[`type_${type}`]}
                    hex={rgbToHex(rgb)}
                    onCopy={trackedRun}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{s.approximationNote}</p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}

function ColorSwatch({ label, hex, onCopy }: { label: string; hex: string; onCopy: () => void }) {
  return (
    <div className="space-y-1 rounded-md border p-2 text-center">
      <div className="h-12 w-full rounded" style={{ backgroundColor: hex }} />
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center justify-center gap-1">
        <code className="font-mono text-xs">{hex}</code>
        <CopyButton text={hex} onCopied={onCopy} />
      </div>
    </div>
  );
}
