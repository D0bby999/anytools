'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useRef, useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { richText } from '../shared/rich-text';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  MAX_DB_BYTES,
  SQLJS_WASM_BASE,
  type SqlJsDatabase,
  type SqlJsStatic,
  type SqlQueryResult,
  type SqlTable,
  createDatabase,
  execSql,
  exportDatabaseBytes,
  importCsvAsTable,
  listTables,
  loadSqlJs,
  queryResultToCsv,
  queryResultToJson,
  validateDbFileSize,
} from './logic';
import { STRINGS } from './strings';

const PREVIEW_ROWS = 500;
const MAX_DB_LABEL = `${Math.round(MAX_DB_BYTES / (1024 * 1024))} MB`;

function ResultTable({ result }: { result: SqlQueryResult }) {
  const shown = result.rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="border-b px-2 py-1 text-left font-mono">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity (SQL result, not entities)
            <tr key={i} className="odd:bg-muted/30">
              {row.map((cell, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <td key={j} className="border-b px-2 py-1 font-mono">
                  {cell === null ? (
                    <span className="text-muted-foreground italic">NULL</span>
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SqlPlaygroundUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const objectUrls = useObjectUrls();
  const sqlRef = useRef<SqlJsStatic | null>(null);
  const dbRef = useRef<SqlJsDatabase | null>(null);

  const [sql, setSql] = useState('');
  const [tables, setTables] = useState<SqlTable[]>([]);
  const [results, setResults] = useState<SqlQueryResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tableName, setTableName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [dbFiles, setDbFiles] = useState<File[]>([]);

  const ensureDb = async (bytes?: Uint8Array): Promise<SqlJsDatabase> => {
    if (!sqlRef.current) sqlRef.current = await loadSqlJs(SQLJS_WASM_BASE);
    if (bytes) {
      dbRef.current?.close();
      dbRef.current = createDatabase(sqlRef.current, bytes);
    } else if (!dbRef.current) {
      dbRef.current = createDatabase(sqlRef.current);
    }
    return dbRef.current;
  };

  const withDb = async (step: (db: SqlJsDatabase) => void, fallback: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const db = await ensureDb();
      step(db);
      setTables(listTables(db));
    } catch (e) {
      setError(toolErrorText(e, s, fallback));
    } finally {
      setBusy(false);
    }
  };

  const runQuery = () => {
    if (!sql.trim()) return;
    trackEvent('tool_run', { tool: 'sql-playground' });
    withDb((db) => {
      const outcome = execSql(db, sql);
      if (outcome.ok) setResults(outcome.results);
      else {
        setResults([]);
        setError(outcome.error);
      }
    }, ui.conversionFailed);
  };

  const runImportCsv = () => {
    withDb((db) => {
      const outcome = importCsvAsTable(db, tableName, csvText);
      setInfo(
        s.imported
          .replace('{n}', String(outcome.rowCount))
          .replace('{table}', tableName.trim())
          .replace('{columns}', outcome.columns.join(', ')),
      );
    }, ui.conversionFailed);
  };

  const loadUploadedDb = async () => {
    const file = dbFiles[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      validateDbFileSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const db = await ensureDb(bytes);
      setTables(listTables(db));
      setResults([]);
    } catch (e) {
      setError(toolErrorText(e, s, ui.conversionFailed));
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
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const downloadDb = async () => {
    const db = await ensureDb();
    saveBlob(new Blob([exportDatabaseBytes(db)]), 'database.sqlite');
  };

  const exportResult = (format: 'csv' | 'json') => {
    const last = results[results.length - 1];
    if (!last) return;
    const text = format === 'csv' ? queryResultToCsv(last) : queryResultToJson(last);
    const type = format === 'csv' ? 'text/csv' : 'application/json';
    saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), `result.${format}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            {s.tablesLabel}
          </span>
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.noTables}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {tables.map((t) => (
                <li key={t.name} className="rounded-md border bg-muted px-3 py-1.5 font-mono">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    ({t.columns.map((c) => `${c.name} ${c.type}`).join(', ')})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Textarea forwardRef which biome can't detect statically */}
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{s.sqlLabel}</span>
            <Textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={s.sqlPlaceholder}
              rows={8}
              className="font-mono"
              aria-label={s.sqlLabel}
            />
          </label>
          <Button className="mt-2" onClick={runQuery} disabled={!sql.trim() || busy}>
            {busy ? ui.processing : s.runQuery}
          </Button>
        </div>

        {error && (
          <output className="block whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-sm text-destructive">
            {error}
          </output>
        )}
        {info && !error && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            {info}
          </p>
        )}

        <div>
          <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            {s.resultLabel}
          </span>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.noResult}</p>
          ) : (
            <div className="space-y-3">
              {results.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: result sets are positional (one per SELECT statement)
                <div key={i} className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {s.rowCount.replace('{n}', String(r.rows.length))}
                  </p>
                  <ResultTable result={r} />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => exportResult('csv')}>
                  {s.exportCsv}
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportResult('json')}>
                  {s.exportJson}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.uploadDb}</p>
            <MultiFileDropzone
              files={dbFiles}
              onChange={setDbFiles}
              accept=".sqlite,.db"
              multiple={false}
              label={s.uploadDb}
            />
            <Button size="sm" onClick={loadUploadedDb} disabled={dbFiles.length === 0 || busy}>
              {ui.apply}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadDb}>
              {s.downloadDb}
            </Button>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {s.csvImportTitle}
            </p>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{s.tableName}</span>
              <Input
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder={s.tableNamePlaceholder}
                className="font-mono"
              />
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Textarea forwardRef which biome can't detect statically */}
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{s.csvText}</span>
              <Textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={s.csvPlaceholder}
                rows={4}
                className="font-mono"
              />
            </label>
            <Button
              size="sm"
              onClick={runImportCsv}
              disabled={!tableName.trim() || !csvText.trim() || busy}
            >
              {s.importCsv}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {richText(s.footnote, { size: MAX_DB_LABEL })}
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
