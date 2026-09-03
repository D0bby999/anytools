'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, Input, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  BARCODE_FORMATS,
  type BarcodeFormatId,
  type GeneratedBarcode,
  formatSpec,
  generateBarcode,
  validateBarcodeInput,
} from './logic';

const SAMPLES: Record<BarcodeFormatId, string> = {
  EAN13: '5901234123457',
  EAN8: '96385074',
  UPCA: '036000291452',
  ITF14: '10614141000415',
  ITF: '12345670',
  Code128: 'SKU-000123',
  Code39: 'PART-42',
  DataMatrix: 'https://anytools.pro',
  PDF417: 'Shipment 4471 / bay 12 / 3 cartons',
  Aztec: 'TICKET-2026-0903',
};

/** 1D symbologies are the only ones with a human-readable line under the bars. */
const HRT_FORMATS: ReadonlySet<BarcodeFormatId> = new Set([
  'EAN13',
  'EAN8',
  'UPCA',
  'ITF14',
  'ITF',
  'Code128',
  'Code39',
]);

export function BarcodeGeneratorUi() {
  const objectUrls = useObjectUrls();
  const [format, setFormat] = useState<BarcodeFormatId>('EAN13');
  const [value, setValue] = useState(SAMPLES.EAN13);
  const [scale, setScale] = useState(4);
  const [quietZone, setQuietZone] = useState(true);
  const [humanReadable, setHumanReadable] = useState(true);
  const [result, setResult] = useState<GeneratedBarcode | null>(null);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spec = formatSpec(format);
  // Live feedback: the check-digit arithmetic is pure and instant, so there is no reason to make
  // someone press a button to be told the 13th digit is wrong.
  const preflight = value.trim() ? validateBarcodeInput(format, value) : null;

  const clearResult = () => {
    setResult(null);
    setNote(null);
    setPngUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
    setSvgUrl((prev) => {
      objectUrls.revoke(prev);
      return null;
    });
  };

  const pickFormat = (next: BarcodeFormatId) => {
    setFormat(next);
    setValue(SAMPLES[next]);
    setError(null);
    clearResult();
  };

  const run = async () => {
    trackEvent('tool_run', { tool: 'barcode-generator' });
    setBusy(true);
    setError(null);
    clearResult();
    try {
      const generated = await generateBarcode(format, value, {
        scale,
        quietZone,
        humanReadable: humanReadable && HRT_FORMATS.has(format),
      });
      setResult(generated);
      setNote(generated.value === value.trim() ? null : `Encoded as ${generated.value}.`);
      setPngUrl(objectUrls.create(generated.png));
      setSvgUrl(objectUrls.create(new Blob([generated.svg], { type: 'image/svg+xml' })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This value could not be encoded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Barcode Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <label htmlFor="barcode-format" className="block text-muted-foreground">
            Symbology
          </label>
          <select
            id="barcode-format"
            value={format}
            onChange={(e) => pickFormat(e.target.value as BarcodeFormatId)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {BARCODE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{spec.hint}</p>
        </div>

        <div className="space-y-1 text-sm">
          <label htmlFor="barcode-value" className="block text-muted-foreground">
            Data to encode
          </label>
          <Input
            id="barcode-value"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          {preflight && !preflight.ok && (
            <p className="text-xs text-destructive">{preflight.error}</p>
          )}
          {preflight?.ok && preflight.note && (
            <p className="text-xs text-muted-foreground">{preflight.note}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4 text-sm">
          <div className="space-y-1">
            <label htmlFor="barcode-scale" className="block text-muted-foreground">
              Module size: {scale} px
            </label>
            <input
              id="barcode-scale"
              type="range"
              min={1}
              max={16}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-48"
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={quietZone}
              onChange={(e) => setQuietZone(e.target.checked)}
            />
            Quiet zone (margin)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={humanReadable}
              onChange={(e) => setHumanReadable(e.target.checked)}
              disabled={!HRT_FORMATS.has(format)}
            />
            Print the digits under the bars
          </label>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={busy || !preflight?.ok}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Encoding…' : 'Generate barcode'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && pngUrl && svgUrl && (
          <div className="space-y-3">
            <div className="flex justify-center rounded-md border bg-white p-4">
              {/* A plain <img> on a blob URL: next/image cannot optimise one, and the sibling
                  tools all do the same. Shown as the PNG rather than by injecting the SVG
                  source — putting encoder output through dangerouslySetInnerHTML would be a
                  needless injection surface. (No biome-ignore: biome 1.9.4 has no
                  performance/noImgElement rule, and the suppression the other tools carry is
                  itself an error in this version.) */}
              <img
                src={pngUrl}
                alt={`${spec.label} barcode encoding ${result.value}`}
                className="max-w-full"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {spec.label} · <span className="font-mono">{result.value}</span>
              {note ? ` · ${note}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={pngUrl}
                download={`${result.value}-${format}.png`}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download PNG
              </a>
              <a
                href={svgUrl}
                download={`${result.value}-${format}.svg`}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                Download SVG
              </a>
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Need a QR code? Use the{' '}
          <a href="/en/generators/qr-code-generator" className="underline">
            QR code generator
          </a>{' '}
          — it has templates for Wi-Fi, vCard and email. To check a code you have made, the{' '}
          <a href="/en/image/qr-barcode-scanner" className="underline">
            barcode scanner
          </a>{' '}
          reads it back.
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
