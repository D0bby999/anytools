'use client';
import { trackEvent } from '@anytools/analytics';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type Delimiter,
  SLOW_WORKBOOK_BYTES,
  type SheetData,
  readWorkbookFile,
  toCsv,
  toJson,
} from './logic';

const SLUG = 'xlsx-to-csv';
const PREVIEW_ROWS = 50;

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
];

/** Sheet names may contain anything a person can type; a download filename may not. */
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'sheet';

export function XlsxToCsvUi() {
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [active, setActive] = useState(0);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [quoteAll, setQuoteAll] = useState(false);
  const [bom, setBom] = useState(false);
  const [firstRowAsKeys, setFirstRowAsKeys] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;
  const sheet = sheets?.[active] ?? null;

  const serialise = (rows: string[][]) =>
    format === 'csv' ? toCsv(rows, { delimiter, quoteAll, bom }) : toJson(rows, firstRowAsKeys);

  const output = sheet ? serialise(sheet.rows) : '';
  const preview = sheet ? serialise(sheet.rows.slice(0, PREVIEW_ROWS)) : '';
  const truncated = (sheet?.rows.length ?? 0) > PREVIEW_ROWS;

  const reset = () => {
    setSheets(null);
    setActive(0);
    setError(null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    trackEvent('tool_run', { tool: SLUG });
    try {
      const read = await readWorkbookFile(file);
      setSheets(read);
      setActive(0);
    } catch (e) {
      setSheets(null);
      setError(e instanceof Error ? e.message : 'Could not read this workbook');
    } finally {
      setBusy(false);
    }
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = objectUrls.create(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking in the same tick cancels the download click() just started. The hook revokes
    // everything on unmount; this only stops a long session pinning every saved file.
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const download = (text: string, filename: string) => {
    const type = format === 'json' ? 'application/json' : 'text/csv';
    saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
  };

  const downloadAll = async () => {
    if (!sheets) return;
    setError(null);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const s of sheets) zip.file(`${safeName(s.name)}.${format}`, serialise(s.rows));
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${safeName(file?.name.replace(/\.xlsx$/i, '') ?? 'workbook')}-${format}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the zip');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">XLSX to CSV / JSON</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple={false}
          label="Excel workbook (.xlsx)"
        />

        <p className="text-sm text-muted-foreground">
          <strong>.xlsx only.</strong> The old binary <code>.xls</code>, OpenDocument{' '}
          <code>.ods</code> and Apple Numbers files are different formats and will not open here —
          open one in Excel, LibreOffice or Numbers and use <em>Save As → .xlsx</em> first. Plain{' '}
          <code>.csv</code> files do not need this tool; the{' '}
          <a href="/tools/csv-json" className="underline">
            CSV ↔ JSON converter
          </a>{' '}
          takes those directly.
        </p>

        {file && file.size > SLOW_WORKBOOK_BYTES && (
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            This workbook is over 20 MB. Parsing happens on this page's main thread, so the tab will
            stop responding for a while — possibly a long while. It will still be attempted.
          </output>
        )}

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Reading…' : 'Read workbook'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {sheets && sheet && (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">
                Sheet ({sheets.length} in this workbook)
              </span>
              <select
                value={active}
                onChange={(e) => setActive(Number(e.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name} — {s.rows.length} {s.rows.length === 1 ? 'row' : 'rows'}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm text-muted-foreground">Output</legend>
              <div className="flex gap-4">
                {(['csv', 'json'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="xlsx-format"
                      checked={format === f}
                      onChange={() => setFormat(f)}
                    />
                    {f.toUpperCase()}
                  </label>
                ))}
              </div>
            </fieldset>

            {format === 'csv' ? (
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">Delimiter</span>
                  <select
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value as Delimiter)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {DELIMITERS.map((d) => (
                      <option key={d.label} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={quoteAll}
                    onChange={(e) => setQuoteAll(e.target.checked)}
                  />
                  Quote every field
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bom} onChange={(e) => setBom(e.target.checked)} />
                  Add a UTF-8 BOM (Excel needs it to show accents correctly)
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={firstRowAsKeys}
                    onChange={(e) => setFirstRowAsKeys(e.target.checked)}
                  />
                  Use the first row as object keys
                </label>
                <p className="text-sm text-muted-foreground">
                  Every value is a string — a spreadsheet cell has no JSON type. If you need real
                  numbers and booleans, take the CSV into the{' '}
                  <a href="/tools/csv-json" className="underline">
                    CSV ↔ JSON converter
                  </a>
                  , which types values as it parses.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={output} />
              <button
                type="button"
                onClick={() => download(output, `${safeName(sheet.name)}.${format}`)}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download this sheet
              </button>
              {sheets.length > 1 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
                >
                  Download all {sheets.length} sheets as .zip
                </button>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Preview{truncated ? ` — first ${PREVIEW_ROWS} rows of ${sheet.rows.length}` : ''}.
                Copy and download always use the whole sheet.
              </p>
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {preview}
              </pre>
            </div>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
