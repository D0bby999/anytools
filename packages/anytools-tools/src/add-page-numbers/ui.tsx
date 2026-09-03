'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type AddPageNumbersResult,
  type NumberFormatId,
  type NumberPosition,
  addPageNumbers,
  labelFor,
  readPageCount,
} from './logic';

const POSITIONS: { value: NumberPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top centre' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom centre' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const FORMATS: { value: NumberFormatId; label: string }[] = [
  { value: 'plain', label: '1' },
  { value: 'of-total', label: '1 / 10' },
  { value: 'page-n', label: 'Page 1' },
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18];

const fieldClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AddPageNumbersUi() {
  // Revokes every URL this component created when it unmounts; without it each blob
  // stays pinned for the life of the document, and client-side navigation does not clear it.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [position, setPosition] = useState<NumberPosition>('bottom-center');
  const [format, setFormat] = useState<NumberFormatId>('plain');
  const [startAt, setStartAt] = useState(1);
  const [range, setRange] = useState('');
  const [fontSize, setFontSize] = useState(11);
  const [margin, setMargin] = useState(36);
  const [result, setResult] = useState<AddPageNumbersResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  // Revoke outside the updater: React may run an updater more than once (and does, in
  // StrictMode), which would revoke a URL still on screen and leak the extra ones.
  const reset = () => {
    objectUrls.revoke(downloadUrl);
    setDownloadUrl(null);
    setResult(null);
    setError(null);
  };

  // Read the page count as soon as a file lands, so the range field can say what is valid
  // instead of failing only on submit.
  useEffect(() => {
    if (!file) {
      setPageCount(null);
      return;
    }
    let cancelled = false;
    readPageCount(file)
      .then((n) => !cancelled && setPageCount(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read PDF'));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    reset();
    trackEvent('tool_run', { tool: 'add-page-numbers' });
    try {
      const r = await addPageNumbers(file, {
        position,
        format,
        startAt,
        range,
        fontSize,
        margin,
      });
      setResult(r);
      setDownloadUrl(objectUrls.create(r.blob));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Could not add page numbers');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Add Page Numbers to PDF</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept="application/pdf,.pdf"
          multiple={false}
          label="The PDF to number. Page count and page order are not changed."
        />

        {pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {pageCount} {pageCount === 1 ? 'page' : 'pages'}.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Position</span>
            <select
              value={position}
              onChange={(e) => {
                setPosition(e.target.value as NumberPosition);
                reset();
              }}
              className={fieldClass}
            >
              {POSITIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Format</span>
            <select
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as NumberFormatId);
                reset();
              }}
              className={fieldClass}
            >
              {FORMATS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Start numbering at</span>
            <input
              type="number"
              min={0}
              step={1}
              value={startAt}
              onChange={(e) => {
                // Whole numbers only — `step` governs the spinner, not what can be typed or
                // pasted, and "1.5" would otherwise be numbered 1.5, 2.5, 3.5. An empty field
                // gives NaN from Number(''), so fall back to the first page.
                const typed = Math.trunc(Number(e.target.value));
                setStartAt(Number.isFinite(typed) ? Math.max(0, typed) : 1);
                reset();
              }}
              className={fieldClass}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Pages to number</span>
            <input
              type="text"
              value={range}
              placeholder={pageCount ? `all — or e.g. 2-${pageCount}` : 'all — or e.g. 2-10, 14'}
              onChange={(e) => {
                setRange(e.target.value);
                reset();
              }}
              className={fieldClass}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Font size</span>
            <select
              value={fontSize}
              onChange={(e) => {
                setFontSize(Number(e.target.value));
                reset();
              }}
              className={fieldClass}
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Distance from the edge</span>
            <select
              value={margin}
              onChange={(e) => {
                setMargin(Number(e.target.value));
                reset();
              }}
              className={fieldClass}
            >
              <option value={18}>18 pt — 6 mm</option>
              <option value={28}>28 pt — 10 mm</option>
              <option value={36}>36 pt — 13 mm</option>
              <option value={54}>54 pt — 19 mm</option>
            </select>
          </label>
        </div>

        <p className="text-sm text-muted-foreground">
          Numbers are drawn in Helvetica, the font every PDF reader already has — nothing is
          embedded, so the file barely grows. Latin characters only: the built-in font cannot draw
          Vietnamese tone marks, CJK, Greek, Cyrillic or Arabic. Pages your scanner saved sideways
          are handled — the number follows the page's own rotation.
        </p>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Numbering…' : 'Add page numbers'}
        </button>

        <p className="text-sm text-muted-foreground">
          Preview of the first label:{' '}
          <span className="font-medium">{labelFor(format, startAt, pageCount ?? 10)}</span>
        </p>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && downloadUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              <div className="font-medium">
                Numbered {result.numbered} of {result.pages} {result.pages === 1 ? 'page' : 'pages'}
              </div>
              <p className="mt-1 text-muted-foreground">
                First label "{result.firstLabel}", last label "{result.lastLabel}".
              </p>
            </div>
            <a
              href={downloadUrl}
              download="numbered.pdf"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download numbered.pdf
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
