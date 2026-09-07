'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CheckboxField,
  CopyButton,
  Label,
  MultiFileDropzone,
  PrivacyNote,
  RadioGroup,
  RadioGroupField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useCallback, useMemo, useState } from 'react';
import { richText } from '../shared/rich-text';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type Delimiter,
  MAX_WORKBOOK_BYTES,
  SLOW_WORKBOOK_BYTES,
  type SheetData,
  readWorkbookFile,
  safeName,
  toCsv,
  toJson,
  workbookFileStem,
  zipEntryNames,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'xlsx-to-csv';
const PREVIEW_ROWS = 50;

const DELIMITERS: { value: Delimiter; key: 'comma' | 'semicolon' | 'tab' }[] = [
  { value: ',', key: 'comma' },
  { value: ';', key: 'semicolon' },
  { value: '\t', key: 'tab' },
];

export function XlsxToCsvUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
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
  const tooLarge = !!file && file.size > MAX_WORKBOOK_BYTES;
  const sheet = sheets?.[active] ?? null;

  const serialise = useCallback(
    (rows: string[][]) =>
      format === 'csv' ? toCsv(rows, { delimiter, quoteAll, bom }) : toJson(rows, firstRowAsKeys),
    [format, delimiter, quoteAll, bom, firstRowAsKeys],
  );

  // Serialising the whole sheet is O(cells) and runs on every keystroke-sized state change
  // otherwise — including the ones that cannot affect it, like switching sheets in the picker.
  const output = useMemo(() => (sheet ? serialise(sheet.rows) : ''), [sheet, serialise]);
  const preview = useMemo(
    () => (sheet ? serialise(sheet.rows.slice(0, PREVIEW_ROWS)) : ''),
    [sheet, serialise],
  );
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
      setError(toolErrorText(e, s, s.readFailed));
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
      const names = zipEntryNames(sheets.map((sh) => sh.name));
      sheets.forEach((sh, i) => zip.file(`${names[i]}.${format}`, serialise(sh.rows)));
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${workbookFileStem(file?.name)}-${format}.zip`);
    } catch (e) {
      setError(toolErrorText(e, s, s.zipFailed));
    }
  };

  const csvJsonLink = (
    <a href="/tools/csv-json" className="underline">
      {s.csvJsonLink}
    </a>
  );

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
            reset();
          }}
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple={false}
          label={s.workbookLabel}
        />

        <p className="text-sm text-muted-foreground">
          <strong>{s.xlsxOnly}</strong>{' '}
          {richText(s.formatNote, {
            xls: <code>.xls</code>,
            ods: <code>.ods</code>,
            csv: <code>.csv</code>,
            saveAs: <em>{s.saveAs}</em>,
            link: csvJsonLink,
          })}
        </p>

        {tooLarge && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {s.tooLarge
              .replace('{size}', String(Math.round(file.size / 1024 / 1024)))
              .replace('{max}', String(MAX_WORKBOOK_BYTES / 1024 / 1024))}
          </output>
        )}

        {file && !tooLarge && file.size > SLOW_WORKBOOK_BYTES && (
          <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {s.slow}
          </output>
        )}

        <Button type="button" onClick={run} disabled={!file || busy || tooLarge}>
          {busy ? s.reading : s.readWorkbook}
        </Button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {sheets && sheet && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="xlsx-sheet">
                {s.sheetLabel.replace('{n}', String(sheets.length))}
              </Label>
              <Select value={String(active)} onValueChange={(v) => setActive(Number(v))}>
                <SelectTrigger id="xlsx-sheet">
                  <SelectValue>{sheets[active]?.name ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((sh, i) => (
                    <SelectItem key={sh.name} value={String(i)}>
                      {sh.name} —{' '}
                      {(sh.rows.length === 1 ? s.rowOne : s.rowMany).replace(
                        '{n}',
                        String(sh.rows.length),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <span className="block text-sm font-medium">{ui.output}</span>
              <RadioGroup
                value={format}
                onValueChange={(v) => setFormat(v as 'csv' | 'json')}
                aria-label={ui.output}
                className="flex gap-3"
              >
                {(['csv', 'json'] as const).map((f) => (
                  <RadioGroupField key={f} value={f} label={f.toUpperCase()} />
                ))}
              </RadioGroup>
            </div>

            {format === 'csv' ? (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="xlsx-delimiter">{s.delimiter}</Label>
                  <Select value={delimiter} onValueChange={(v) => setDelimiter(v as Delimiter)}>
                    <SelectTrigger id="xlsx-delimiter">
                      <SelectValue>
                        {s[DELIMITERS.find((d) => d.value === delimiter)?.key ?? 'comma']}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DELIMITERS.map((d) => (
                        <SelectItem key={d.key} value={d.value}>
                          {s[d.key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <CheckboxField
                  label={s.quoteAll}
                  checked={quoteAll}
                  onCheckedChange={(v) => setQuoteAll(v === true)}
                />
                <CheckboxField
                  label={s.bom}
                  checked={bom}
                  onCheckedChange={(v) => setBom(v === true)}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <CheckboxField
                  label={s.firstRowKeys}
                  checked={firstRowAsKeys}
                  onCheckedChange={(v) => setFirstRowAsKeys(v === true)}
                />
                <p className="text-sm text-muted-foreground">
                  {richText(s.jsonNote, { link: csvJsonLink })}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={output} />
              <Button
                size="sm"
                type="button"
                onClick={() => download(output, `${safeName(sheet.name)}.${format}`)}
              >
                {s.downloadSheet}
              </Button>
              {sheets.length > 1 && (
                <Button variant="outline" size="sm" type="button" onClick={downloadAll}>
                  {s.downloadAllSheets.replace('{n}', String(sheets.length))}
                </Button>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {truncated
                  ? s.previewFirst
                      .replace('{n}', String(PREVIEW_ROWS))
                      .replace('{total}', String(sheet.rows.length))
                  : s.previewAll}
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
