'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  Input,
  Label,
  PrivacyNote,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  BARCODE_FORMATS,
  type BarcodeFormatId,
  type GeneratedBarcode,
  formatSpec,
  generateBarcode,
  validateBarcodeInput,
} from './logic';
import { STRINGS } from './strings';

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

/** Localized text for a coded message returned by the logic layer, falling back to its English. */
function localizedMessage(
  table: Record<string, string>,
  key: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const template = table[key];
  if (!template) return fallback;
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template,
  );
}

export function BarcodeGeneratorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
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
  // The logic layer carries English hints; map them to the locale by symbology id.
  const hints: Record<BarcodeFormatId, string> = {
    EAN13: s.hint_EAN13,
    EAN8: s.hint_EAN8,
    UPCA: s.hint_UPCA,
    ITF14: s.hint_ITF14,
    ITF: s.hint_ITF,
    Code128: s.hint_Code128,
    Code39: s.hint_Code39,
    DataMatrix: s.hint_DataMatrix,
    PDF417: s.hint_PDF417,
    Aztec: s.hint_Aztec,
  };
  const [linkBefore, linkRest] = s.crossLink.split('{qr}');
  const [linkMiddle, linkAfter] = (linkRest ?? '').split('{scanner}');
  // Live feedback: the check-digit arithmetic is pure and instant, so there is no reason to make
  // someone press a button to be told the 13th digit is wrong.
  const preflight = value.trim() ? validateBarcodeInput(format, value) : null;

  // Live preview, learned from iib0011/omni-tools' QR tool (MIT): it has no Generate button and
  // recomputes behind a debounce. Encoding here is a WASM call, so the debounce is doing real
  // work, and `generation` discards a result that landed after the inputs moved on — without it
  // a slow encode of an old value can overwrite a newer one.
  const generation = useRef(0);
  const trackedRef = useRef(false);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: run() closes over every input it
  // needs; listing it here instead would re-fire the effect on each render.
  useEffect(() => {
    if (!preflight?.ok) {
      clearResult();
      return;
    }
    const id = ++generation.current;
    const timer = setTimeout(() => {
      if (id === generation.current) void run();
    }, 350);
    return () => clearTimeout(timer);
  }, [format, value, scale, quietZone, humanReadable, preflight?.ok]);

  const run = async () => {
    // Live preview fires this on every settled edit, so gate the analytics event on the first
    // success per mount. Firing per keystroke would turn "someone used the tool" into "someone
    // typed", and dropping it entirely (which is what the other live tools here do) would
    // silently remove a signal the owner may still want.
    if (!trackedRef.current) {
      trackEvent('tool_run', { tool: 'barcode-generator' });
      trackedRef.current = true;
    }
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
      setNote(
        generated.value === value.trim() ? null : s.encodedAs.replace('{value}', generated.value),
      );
      setPngUrl(objectUrls.create(generated.png));
      setSvgUrl(objectUrls.create(new Blob([generated.svg], { type: 'image/svg+xml' })));
    } catch (e) {
      setError(toolErrorText(e, s, s.encodeFailed));
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
        <div className="space-y-1 text-sm">
          <Label htmlFor="barcode-format">{s.symbology}</Label>
          <Select value={format} onValueChange={(v) => pickFormat(v as BarcodeFormatId)}>
            <SelectTrigger id="barcode-format">
              <SelectValue>
                {BARCODE_FORMATS.find((f) => f.id === format)?.label ?? format}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BARCODE_FORMATS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{hints[format] ?? spec.hint}</p>
        </div>

        <div className="space-y-1 text-sm">
          <label htmlFor="barcode-value" className="block text-muted-foreground">
            {s.dataToEncode}
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
            <p className="text-xs text-destructive">
              {localizedMessage(s, `error_${preflight.code}`, preflight.params, preflight.error)}
            </p>
          )}
          {preflight?.ok && preflight.note && (
            <p className="text-xs text-muted-foreground">
              {localizedMessage(
                s,
                `note_${preflight.noteCode}`,
                preflight.noteParams,
                preflight.note,
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4 text-sm">
          <RangeSlider
            className="w-48"
            label={s.moduleSizeLabel}
            unit="px"
            value={scale}
            min={1}
            max={16}
            onChange={setScale}
          />
          <CheckboxField
            label={s.quietZone}
            checked={quietZone}
            onCheckedChange={(v) => setQuietZone(v === true)}
          />
          <CheckboxField
            label={s.printDigits}
            checked={humanReadable}
            onCheckedChange={(v) => setHumanReadable(v === true)}
            disabled={!HRT_FORMATS.has(format)}
          />
        </div>

        {busy && <p className="text-sm text-muted-foreground">{s.encoding}</p>}

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
                alt={s.imageAlt.replace('{format}', spec.label).replace('{value}', result.value)}
                className="max-w-full"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {spec.label} · <span className="font-mono">{result.value}</span>
              {note ? ` · ${note}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={pngUrl} download={`${result.value}-${format}.png`}>
                  {s.downloadPng}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={svgUrl} download={`${result.value}-${format}.svg`}>
                  {s.downloadSvg}
                </a>
              </Button>
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {linkBefore}
          <a href={`/${locale}/generators/qr-code-generator`} className="underline">
            {s.qrLink}
          </a>
          {linkMiddle}
          <a href={`/${locale}/image/qr-barcode-scanner`} className="underline">
            {s.scannerLink}
          </a>
          {linkAfter}
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
